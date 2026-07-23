// Shared "camera viewer" - renders a single camera into a container element:
// a dewarped canvas for fisheye cameras, a plain <video> for standard ones.
// Used by the camera detail page and the per-row list preview, so every
// place a camera is shown behaves the same way.
//
// Playback is rtsp-to-web's MSE endpoint: a raw WebSocket pushing fragmented-mp4 straight
// into a MediaSource, no HTTP polling of an HLS playlist/segments. Safari still gets native
// HLS (its own low-latency HLS implementation is more robust than a hand-rolled MSE client).
// We moved off hls.js-over-LL-HLS because on-demand streams starting late produced repeated
// manifestParsingError retries, and periodic bufferAppendError/live-edge-drift fatal errors
// forced full multi-second reattaches - all inherent to polling a playlist over HTTP.
import {createFisheyeDewarp} from './fisheye-dewarp.js';

const RETRY_DELAY_MS = 4000;

function buildWhepUrl(channelId) {
  const proto = window.location.protocol === 'https:' ? 'https' : 'http';
  return proto + '://' + window.location.hostname + ':8889/' + channelId + '/whep';
}

function buildIframeUrl(channelId) {
  const proto = window.location.protocol === 'https:' ? 'https' : 'http';
  return proto + '://' + window.location.hostname + ':8889/' + channelId + '/';
}

/**
 * Connects to MediaMTX WHEP WebRTC endpoint and feeds it to videoEl.
 */
export function attachWhepStream(videoEl, channelId, opts) {
  let whepPc = null;
  let closed = false;

  async function connect() {
    if (closed) return;
    try {
      whepPc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      whepPc.addTransceiver('video', { direction: 'recvonly' });
      whepPc.addTransceiver('audio', { direction: 'recvonly' });

      whepPc.ontrack = (ev) => {
        if (videoEl.srcObject !== ev.streams[0]) {
          videoEl.srcObject = ev.streams[0];
          videoEl.play().catch(() => {});
        }
      };

      whepPc.onconnectionstatechange = () => {
        if (closed) return;
        const st = whepPc.connectionState;
        if (st === 'failed' || st === 'disconnected' || st === 'closed') {
          fail('connection state ' + st);
        }
      };

      const offer = await whepPc.createOffer();
      await whepPc.setLocalDescription(offer);

      await new Promise((resolve) => {
        if (whepPc.iceGatheringState === 'complete') { resolve(); return; }
        const onChange = () => {
          if (whepPc.iceGatheringState === 'complete') {
            whepPc.removeEventListener('icegatheringstatechange', onChange);
            resolve();
          }
        };
        whepPc.addEventListener('icegatheringstatechange', onChange);
        setTimeout(resolve, 3000);
      });

      const url = buildWhepUrl(channelId);
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: whepPc.localDescription.sdp
      });

      if (!resp.ok) {
        throw new Error('WHEP request failed: ' + resp.status);
      }

      const answerSdp = await resp.text();
      await whepPc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    } catch (err) {
      fail('WHEP connect error', err);
    }
  }

  function cleanup() {
    if (whepPc) {
      try { whepPc.close(); } catch (e) {}
      whepPc = null;
    }
    if (videoEl.srcObject) {
      videoEl.srcObject = null;
    }
  }

  function fail(reason, err) {
    if (closed) return;
    closed = true;
    console.warn('WHEP stream failed (' + reason + '):', err || '');
    cleanup();
    if (opts && opts.onFatal) {
      opts.onFatal();
    }
  }

  connect();

  return {
    destroy() {
      closed = true;
      cleanup();
    },
  };
}

/**
 * @param {HTMLElement} container an empty element the viewer can fill
 * @return {{show: function, destroy: function}}
 */
export function createCameraViewer(container) {
  let dewarp = null;
  let hiddenVideo = null;
  let visibleVideo = null;
  let streamConn = null;
  // Set only by the public destroy() (not by the internal teardown() that show() also
  // calls to reset before rendering) - stops any pending retry from firing after the
  // viewer has actually been torn down for good.
  let stopped = false;

  function teardown() {
    if (dewarp) {
      dewarp.destroy();
      dewarp = null;
    }
    if (streamConn) {
      streamConn.destroy();
      streamConn = null;
    }
    if (hiddenVideo) {
      hiddenVideo.remove();
      hiddenVideo = null;
    }
    if (visibleVideo) {
      visibleVideo.remove();
      visibleVideo = null;
    }
    container.innerHTML = '';
  }

  function attachStream(videoEl, camera) {
    streamConn = attachWhepStream(videoEl, camera.channelId, {
      onFatal() {
        if (stopped) {
          return;
        }
        console.warn('WHEP stream failed, retrying in ' + RETRY_DELAY_MS + 'ms');
        streamConn = null;
        videoEl.srcObject = null;
        setTimeout(() => {
          if (!stopped) {
            attachStream(videoEl, camera);
          }
        }, RETRY_DELAY_MS);
      },
    });
  }

  /**
   * @param {object} camera {type, streamId, channelId, fisheyeParams, testVideoUrl}
   * @return {{setEphemeral: function, mode: (string|null)}}
   */
  function show(camera) {
    teardown();

    if (camera.type === 'fisheye') {
      const canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.display = 'block';
      container.appendChild(canvas);

      dewarp = createFisheyeDewarp(canvas);
      const fisheyeParams = camera.fisheyeParams || {};
      dewarp.setParams(fisheyeParams);
      dewarp.setEphemeral({flip: !!fisheyeParams.flip, ccw: !!fisheyeParams.ccw});

      hiddenVideo = document.createElement('video');
      hiddenVideo.muted = true;
      hiddenVideo.playsInline = true;
      hiddenVideo.autoplay = true;
      hiddenVideo.crossOrigin = 'anonymous';
      hiddenVideo.style.cssText = 'position:absolute; top:0; left:0; width:256px; height:256px; opacity:0.99; pointer-events:none; z-index:-1;';
      container.appendChild(hiddenVideo);
      hiddenVideo.addEventListener('loadedmetadata', function() {
        dewarp.setSource(hiddenVideo, hiddenVideo.videoWidth, hiddenVideo.videoHeight, true);
      });

      attachStream(hiddenVideo, camera);
      dewarp.startLoop();

      return {
        setEphemeral: (ephemeral) => dewarp && dewarp.setEphemeral(ephemeral),
        mode: fisheyeParams.mode || 'seg',
      };
    }

    const iframe = document.createElement('iframe');
    iframe.src = buildIframeUrl(camera.channelId);
    iframe.style.cssText = 'width:100%; height:100%; border:none; display:block; aspect-ratio: 16/9;';
    iframe.allow = 'autoplay; fullscreen';
    container.appendChild(iframe);
    
    // We don't need a stream object for iframe since it handles it internally
    visibleVideo = iframe;

    return {setEphemeral: () => {}, mode: null};
  }

  return {
    show,
    destroy() {
      stopped = true;
      teardown();
    },
    /** Call after the container's size changes (e.g. an expand/collapse toggle) so a
     * fisheye canvas recalculates its height from the configured aspect ratio. A no-op
     * for standard cameras - the <video> element is already responsive on its own. */
    resize() {
      if (dewarp) {
        dewarp.resize();
      }
    },
  };
}
