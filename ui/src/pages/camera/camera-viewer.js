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
// How much buffered history (seconds behind currentTime) to keep before trimming. Live
// playback never seeks backward, so anything older is dead weight that would otherwise
// grow the SourceBuffer without bound until the browser throws QuotaExceededError.
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
  let ws = null;
  let mediaSource = null;
  let sourceBuffer = null;
  let objectUrl = null;
  let mimeType = null;
  let queue = [];
  let closed = false;

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
    mediaSource = null;
    sourceBuffer = null;
    queue = [];
  }

  function fail(reason, err) {
    if (closed) {
      return;
    }
    closed = true;
    console.warn('MSE stream failed (' + reason + '):', err || '');
    cleanup();
    opts.onFatal();
  }

  function pump() {
    if (!sourceBuffer || sourceBuffer.updating || closed) {
      return;
    }
    // Trim old buffered data before appending more - resumes here via the next
    // 'updateend' once the removal completes.
    const buffered = sourceBuffer.buffered;
    if (buffered.length && videoEl.currentTime - buffered.start(0) > MSE_BACK_BUFFER_SECONDS) {
      try {
        sourceBuffer.remove(buffered.start(0), videoEl.currentTime - MSE_BACK_BUFFER_SECONDS);
      } catch (e) {
        // ignore - not worth failing the stream over a trim that didn't take
      }
      return;
    }
    if (queue.length === 0) {
      return;
    }
    const chunk = queue.shift();
    try {
      sourceBuffer.appendBuffer(chunk);
    } catch (e) {
      // A QuotaExceededError here means the browser's own memory limit was hit despite
      // trimming above - drop the backlog rather than get stuck retrying the same chunk.
      queue = [];
      fail('appendBuffer', e);
    }
  }

  function maybeInitSourceBuffer() {
    if (!mimeType || !mediaSource || mediaSource.readyState !== 'open' || sourceBuffer) {
      return;
    }
    try {
      sourceBuffer = mediaSource.addSourceBuffer(mimeType);
    } catch (e) {
      fail('addSourceBuffer', e);
      return;
    }
    sourceBuffer.mode = 'segments';
    sourceBuffer.addEventListener('updateend', pump);
    pump();
  }

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
    // message: a leading byte of 9 means "the rest of this message (UTF-8) is the codec
    // string for addSourceBuffer", anything else is fragment data to append as-is.
    const data = new Uint8Array(event.data);
    if (data[0] === 9) {
      const codecs = new TextDecoder('utf-8').decode(data.slice(1));
      mimeType = 'video/mp4; codecs="' + codecs + '"';
      mediaSource = new MediaSource();
      objectUrl = URL.createObjectURL(mediaSource);
      videoEl.src = objectUrl;
      mediaSource.addEventListener('sourceopen', maybeInitSourceBuffer);
      maybeInitSourceBuffer();
      videoEl.play().catch(() => {});
      return;
    }
    queue.push(event.data);
    pump();
  };

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
