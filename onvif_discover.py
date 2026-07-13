#!/usr/bin/env python3
"""Discover ONVIF devices on the local network using WS-Discovery.

Sends a WS-Discovery Probe multicast message and listens for ProbeMatch
responses from ONVIF-compliant devices (cameras, encoders, etc).

Usage:
    python onvif_discover.py [--timeout SECONDS] [--interface IP] [-v]
"""

import argparse
import logging
import re
import socket
import sys
import time
import uuid
from xml.etree import ElementTree

WS_DISCOVERY_ADDR = "239.255.255.250"
WS_DISCOVERY_PORT = 3702

# Per the WS-Discovery spec, a Probe with no Types element matches ALL
# devices, not just ONVIF cameras. Some NVRs/encoders don't advertise the
# dn:NetworkVideoTransmitter type and only answer an untyped probe, so we
# send both a typed and an untyped probe on every round.
PROBE_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:{message_id}</w:MessageID>
    <w:To e:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action a:mustUnderstand="1" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>{types}</d:Probe>
  </e:Body>
</e:Envelope>"""

PROBE_RETRY_INTERVAL = 2.0

logger = logging.getLogger("onvif_discover")


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def find_by_local_name(root: ElementTree.Element, name: str) -> ElementTree.Element | None:
    for el in root.iter():
        if local_name(el.tag) == name:
            return el
    return None


def detect_interface() -> str | None:
    """Find the local IPv4 address of the default outbound interface.

    Multiple virtual adapters (VMware, WSL, VPNs) can cause the OS to pick
    the wrong outbound interface for multicast. Connecting a UDP socket to
    a well-known external anchor address (no packets are actually sent for
    connect()) reveals which local address the kernel would use, so we can
    bind the real probe there.

    Note: on Windows, connecting directly to the default *gateway* address
    (e.g. 192.168.0.1) can make getsockname() report the gateway's own IP
    instead of the local interface, so a neutral non-gateway anchor is used
    instead.
    """
    try:
        probe_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe_sock.connect(("8.8.8.8", 80))
        local_ip = probe_sock.getsockname()[0]
        probe_sock.close()
        logger.debug("Auto-detected local interface %s", local_ip)
        return local_ip
    except OSError as exc:
        logger.debug("Could not auto-detect local interface: %s", exc)
        return None


def setup_logging(verbose: bool, log_file: str) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logger.setLevel(logging.DEBUG)

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(level)
    console.setFormatter(fmt)
    logger.addHandler(console)

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)


def build_probe_message(types: str = "") -> bytes:
    message_id = str(uuid.uuid4())
    xml = PROBE_TEMPLATE.format(message_id=message_id, types=types)
    return xml.encode("utf-8")


def parse_probe_match(data: bytes, addr: tuple) -> dict | None:
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as exc:
        logger.debug("Failed to parse response from %s: %s", addr[0], exc)
        logger.debug("Raw response from %s: %r", addr[0], data[:2000])
        return None

    # Namespace-agnostic lookups: some devices reply with SOAP 1.1 instead
    # of 1.2, or otherwise vary their namespace declarations, so match on
    # local tag name rather than requiring an exact namespace URI.
    match = find_by_local_name(root, "ProbeMatch")
    if match is None:
        logger.debug("No ProbeMatch in response from %s (root tag: %s)", addr[0], local_name(root.tag))
        logger.debug("Raw response from %s: %r", addr[0], data[:2000])
        return None

    xaddrs_el = find_by_local_name(match, "XAddrs")
    types_el = find_by_local_name(match, "Types")
    scopes_el = find_by_local_name(match, "Scopes")
    epr_el = find_by_local_name(match, "Address")

    xaddrs = xaddrs_el.text.strip().split() if xaddrs_el is not None and xaddrs_el.text else []
    scopes = scopes_el.text.strip().split() if scopes_el is not None and scopes_el.text else []

    name = None
    hardware = None
    for scope in scopes:
        m = re.search(r"onvif://www\.onvif\.org/name/(\S+)", scope)
        if m:
            name = m.group(1).replace("%20", " ")
        m = re.search(r"onvif://www\.onvif\.org/hardware/(\S+)", scope)
        if m:
            hardware = m.group(1).replace("%20", " ")

    return {
        "source_ip": addr[0],
        "endpoint": epr_el.text.strip() if epr_el is not None and epr_el.text else None,
        "xaddrs": xaddrs,
        "types": types_el.text.strip() if types_el is not None and types_el.text else None,
        "name": name,
        "hardware": hardware,
        "scopes": scopes,
    }


def is_onvif_camera(device: dict) -> bool:
    """Heuristic: an untyped probe also draws responses from plain WSD
    devices (Windows PCs, printers, NAS boxes) that aren't ONVIF cameras
    at all. Real ONVIF services advertise the NetworkVideoTransmitter type
    or expose an /onvif/... device service path.
    """
    if device["types"] and "NetworkVideoTransmitter" in device["types"]:
        return True
    return any("onvif" in xaddr.lower() for xaddr in device["xaddrs"])


def send_probes(sock: socket.socket) -> None:
    typed_probe = build_probe_message("\n      <d:Types>dn:NetworkVideoTransmitter</d:Types>\n    ")
    untyped_probe = build_probe_message()
    logger.debug("Sending WS-Discovery Probes (typed + untyped) to %s:%s", WS_DISCOVERY_ADDR, WS_DISCOVERY_PORT)
    sock.sendto(typed_probe, (WS_DISCOVERY_ADDR, WS_DISCOVERY_PORT))
    sock.sendto(untyped_probe, (WS_DISCOVERY_ADDR, WS_DISCOVERY_PORT))


def discover(timeout: float, interface: str | None) -> list[dict]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    if interface:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(interface))
        sock.bind((interface, 0))
        logger.debug("Bound socket to interface %s", interface)

    deadline = time.monotonic() + timeout
    next_send = 0.0  # send immediately on first loop iteration

    devices = {}
    try:
        while True:
            now = time.monotonic()
            remaining = deadline - now
            if remaining <= 0:
                break

            if now >= next_send:
                send_probes(sock)
                next_send = now + PROBE_RETRY_INTERVAL

            sock.settimeout(min(remaining, 0.5))
            try:
                data, addr = sock.recvfrom(65535)
            except socket.timeout:
                continue

            logger.debug("Received %d bytes from %s", len(data), addr[0])
            device = parse_probe_match(data, addr)
            if device is None:
                continue

            # Dedupe by source IP, not endpoint UUID: a device's endpoint
            # UUID can repeat across responses (retransmits, multi-homed
            # NICs, or a DHCP lease change between runs). What the caller
            # cares about is which IPs actually answered on the LAN, so
            # each distinct source IP is reported even if the endpoint UUID
            # matches one already seen.
            key = device["source_ip"]
            if key in devices:
                logger.debug("Duplicate response from %s (retransmit)", key)
                continue

            devices[key] = device
            logger.info(
                "Found device: %s | name=%s | xaddrs=%s",
                device["source_ip"],
                device["name"] or "unknown",
                ", ".join(device["xaddrs"]) or "none",
            )

            if device["endpoint"]:
                same_endpoint_ips = sorted(
                    d["source_ip"] for d in devices.values() if d["endpoint"] == device["endpoint"]
                )
                if len(same_endpoint_ips) > 1:
                    logger.warning(
                        "Endpoint %s answered from multiple IPs: %s. Likely the same physical "
                        "device (DHCP lease change or multi-homed NIC), not separate devices.",
                        device["endpoint"],
                        ", ".join(same_endpoint_ips),
                    )
    finally:
        sock.close()

    return list(devices.values())


def main() -> int:
    parser = argparse.ArgumentParser(description="Discover ONVIF devices via WS-Discovery")
    parser.add_argument("--timeout", type=float, default=5.0, help="Seconds to wait for responses (default: 5)")
    parser.add_argument("--interface", default=None, help="Local IP of the network interface to send the probe from")
    parser.add_argument("--log-file", default="onvif_discover.log", help="Path to the log file")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable verbose (debug) console logging")
    args = parser.parse_args()

    setup_logging(args.verbose, args.log_file)

    interface = args.interface or detect_interface()

    logger.info("Starting ONVIF discovery (timeout=%ss, interface=%s)", args.timeout, interface or "default")

    try:
        devices = discover(args.timeout, interface)
    except PermissionError as exc:
        logger.error("Permission error opening socket: %s", exc)
        return 1
    except OSError as exc:
        logger.error("Network error during discovery: %s", exc)
        return 1

    if not devices:
        logger.warning("No ONVIF devices found.")
        return 0

    cameras = [d for d in devices if is_onvif_camera(d)]
    others = [d for d in devices if not is_onvif_camera(d)]

    logger.info("Discovery complete. %d likely ONVIF camera(s), %d other WS-Discovery device(s).", len(cameras), len(others))

    for device in cameras:
        logger.info("-" * 60)
        logger.info("IP:       %s", device["source_ip"])
        logger.info("Name:     %s", device["name"] or "unknown")
        logger.info("Hardware: %s", device["hardware"] or "unknown")
        logger.info("XAddrs:   %s", ", ".join(device["xaddrs"]) or "none")
        logger.info("Endpoint: %s", device["endpoint"] or "unknown")

    if others:
        logger.info("-" * 60)
        logger.info(
            "Other WS-Discovery devices (PCs/printers/NAS answering the untyped probe, not ONVIF cameras): %s",
            ", ".join(sorted(d["source_ip"] for d in others)),
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
