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
// How much buffered history (seconds behind currentTime) to keep. Without this, a
// long-running live session keeps growing the SourceBuffer forever until the browser's
// own automatic eviction kicks in to free space - which can cause a visible decode
// hiccup right as it happens. Trimming proactively and gradually avoids ever hitting
// that automatic eviction. Most noticeable on the fisheye dewarp (a raw WebGL canvas
// has no built-in stall/rebuffer handling to smooth a hiccup over, unlike a plain
// <video> element), but applies to every stream.
const MSE_BACK_BUFFER_SECONDS = 15;

function buildHlsLLUrl(streamId, channelId) {
  return window.location.protocol + '//' + window.location.hostname + ':8083' +
    '/stream/' + streamId + '/channel/' + channelId + '/hlsll/live/index.m3u8';
}

function buildMseUrl(streamId, channelId) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return proto + '://' + window.location.hostname + ':8083' +
    '/stream/' + streamId + '/channel/' + channelId +
    '/mse?uuid=' + streamId + '&channel=' + channelId;
}

/**
 * Opens rtsp-to-web's MSE endpoint (WebSocket + MediaSource) for a camera channel and
 * feeds it straight into videoEl.
 * @param {HTMLVideoElement} videoEl
 * @param {string} streamId
 * @param {string} channelId
 * @param {{onFatal: function}} opts onFatal is called at most once, on an unrecoverable
 *   error - the caller owns retry policy (every current caller waits RETRY_DELAY_MS then
 *   reattaches from scratch, same as a page refresh).
 * @return {{destroy: function}}
 */
export function attachMseStream(videoEl, streamId, channelId, opts) {
  const queue = [];
  let sourceBuffer = null;
  let streamingStarted = false;
  let ws = null;
  let closed = false;

  // MediaSource + videoEl.src must be set up synchronously, up front - opening the
  // WebSocket only inside 'sourceopen' (below) rather than immediately is what keeps
  // this video "clean" for WebGL to read as a texture (the fisheye dewarp canvas).
  // Reordering this - e.g. opening the socket first and only creating the MediaSource
  // once the first packet arrives - reproduced a SecurityError ("video element contains
  // cross-origin data") from THREE.js's texImage2D, even though the src is always a
  // same-origin blob: URL either way.
  const mediaSource = new MediaSource();
  let objectUrl = URL.createObjectURL(mediaSource);
  videoEl.src = objectUrl;

  function cleanup() {
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch (e) {
        // ignore - we're tearing down anyway
      }
      ws = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function fail(reason, err) {
    if (closed) {
      return;
    }
    closed = true;
    console.warn('MSE stream failed (' + reason + '):', err || '');
    videoEl.removeEventListener('pause', onPause);
    cleanup();
    opts.onFatal();
  }

  // The first packet after a SourceBuffer is created gets appended immediately -
  // otherwise it can sit queued indefinitely since nothing has triggered an 'updateend'
  // yet to drain the queue.
  function readPacket(packet) {
    if (!sourceBuffer) {
      queue.push(packet);
      return;
    }
    if (!streamingStarted) {
      streamingStarted = true;
      try {
        sourceBuffer.appendBuffer(packet);
      } catch (e) {
        fail('appendBuffer', e);
      }
      return;
    }
    queue.push(packet);
    if (!sourceBuffer.updating) {
      pushPacket();
    }
  }

  function pushPacket() {
    if (sourceBuffer && !sourceBuffer.updating) {
      // Trim buffered data older than the back-buffer window before appending more -
      // 'updateend' (already wired to this function) fires again once the removal
      // completes, so this just resumes appending on the next call.
      const buffered = sourceBuffer.buffered;
      if (buffered.length && videoEl.currentTime - buffered.start(0) > MSE_BACK_BUFFER_SECONDS) {
        try {
          sourceBuffer.remove(0, videoEl.currentTime - MSE_BACK_BUFFER_SECONDS);
          return;
        } catch (e) {
          // ignore - not worth failing the stream over a trim that didn't take
        }
      }
      if (queue.length > 0) {
        const packet = queue.shift();
        try {
          sourceBuffer.appendBuffer(packet);
        } catch (e) {
          fail('appendBuffer', e);
          return;
        }
      }
    }
    // A backgrounded tab throttles video decode - without an active audio track to keep
    // it "alive", playback can stall indefinitely. Snapping to near the live edge each
    // time keeps it from falling permanently behind while hidden.
    if (document.hidden && videoEl.buffered.length > 0) {
      videoEl.currentTime = videoEl.buffered.end(videoEl.buffered.length - 1) - 0.5;
    }
  }

  // Safari-specific: low-latency MSE playback can stall with currentTime past the
  // buffered range; nudge back in and resume rather than staying frozen.
  function onPause() {
    if (videoEl.buffered.length > 0 &&
        videoEl.currentTime > videoEl.buffered.end(videoEl.buffered.length - 1)) {
      videoEl.currentTime = videoEl.buffered.end(videoEl.buffered.length - 1) - 0.1;
      videoEl.play().catch(() => {});
    }
  }
  videoEl.addEventListener('pause', onPause);

  mediaSource.addEventListener('sourceopen', function() {
    ws = new WebSocket(buildMseUrl(streamId, channelId));
    ws.binaryType = 'arraybuffer';

    ws.onerror = function(e) {
      fail('websocket error', e);
    };
    ws.onclose = function(e) {
      // Our own cleanup() nulls out ws before calling close(), so this only fires for an
      // unexpected server-side/network close, never our own teardown.
      if (ws) {
        fail('websocket closed', e);
      }
    };
    ws.onmessage = function(event) {
      // Every message is binary (ws.binaryType = 'arraybuffer') - rtsp-to-web multiplexes
      // the one-time codec announcement into the same stream as the fmp4 fragments by
      // prefixing it with a marker byte, rather than sending it as a separate text/JSON
      // message: a leading byte of 9 means "the rest of this message (UTF-8) is the
      // codec string for addSourceBuffer", anything else is fragment data to append.
      const data = new Uint8Array(event.data);
      if (data[0] === 9) {
        const codecs = new TextDecoder('utf-8').decode(data.slice(1));
        try {
          sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="' + codecs + '"');
        } catch (e) {
          fail('addSourceBuffer', e);
          return;
        }
        sourceBuffer.mode = 'segments';
        sourceBuffer.addEventListener('updateend', pushPacket);
        return;
      }
      readPacket(event.data);
    };

    videoEl.play().catch(() => {});
  }, {once: true});

  return {
    destroy() {
      closed = true;
      videoEl.removeEventListener('pause', onPause);
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
  let mse = null;
  // Set only by the public destroy() (not by the internal teardown() that show() also
  // calls to reset before rendering) - stops any pending retry from firing after the
  // viewer has actually been torn down for good.
  let stopped = false;

  function teardown() {
    if (dewarp) {
      dewarp.destroy();
      dewarp = null;
    }
    if (mse) {
      mse.destroy();
      mse = null;
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
    if (camera.testVideoUrl) {
      videoEl.src = camera.testVideoUrl;
      videoEl.play().catch(() => {});
      return;
    }

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari's own low-latency HLS implementation is more robust here than a
      // hand-rolled MSE client - hand it the LL-HLS URL directly, no hls.js involved.
      videoEl.src = buildHlsLLUrl(camera.streamId, camera.channelId);
      return;
    }

    if (!window.MediaSource) {
      console.error('This browser supports neither MSE nor native HLS playback.');
      return;
    }

    mse = attachMseStream(videoEl, camera.streamId, camera.channelId, {
      onFatal() {
        if (stopped) {
          return;
        }
        console.warn('MSE stream failed, retrying in ' + RETRY_DELAY_MS + 'ms');
        mse = null;
        videoEl.removeAttribute('src');
        videoEl.load();
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

      // Source video is never meant to be seen directly, but must stay attached to the
      // document (not display:none) - browsers throttle decoding of detached video
      // elements, which would show up as dropped frames in the dewarped canvas.
      hiddenVideo = document.createElement('video');
      hiddenVideo.muted = true;
      hiddenVideo.playsInline = true;
      hiddenVideo.autoplay = true;
      // Chrome taints MSE-backed video elements for WebGL texture reads ("contains
      // cross-origin data") unless crossOrigin is explicitly set, even though the src is
      // always a same-origin blob: URL - confirmed by testing: fixing the MediaSource/
      // WebSocket setup order alone did NOT stop this error, only this does.
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

    visibleVideo = document.createElement('video');
    // height:auto (not left to inherited/default CSS) so the video keeps its natural
    // aspect ratio instead of being stretched/cropped to fill some unrelated height.
    visibleVideo.style.cssText = 'width:100%; height:auto; display:block;';
    visibleVideo.controls = true;
    visibleVideo.autoplay = true;
    visibleVideo.muted = true;
    visibleVideo.playsInline = true;
    container.appendChild(visibleVideo);

    attachStream(visibleVideo, camera);

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
