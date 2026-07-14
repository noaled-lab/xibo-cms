// Shared "camera viewer" - renders a single camera into a container element:
// a dewarped canvas for fisheye cameras, a plain <video> for standard ones.
// Used by the camera detail page and the per-row list preview, so every
// place a camera is shown behaves the same way.
//
// Playback is LL-HLS only (rtsp-to-web's low-latency HLS endpoint, played
// via hls.js, falling back to native HLS on Safari). MSE is not used here.
import Hls from 'hls.js';
import {createFisheyeDewarp} from './fisheye-dewarp.js';

const RETRY_DELAY_MS = 4000;

function buildHlsLLUrl(streamId, channelId) {
  return window.location.protocol + '//' + window.location.hostname + ':8083' +
    '/stream/' + streamId + '/channel/' + channelId + '/hlsll/live/index.m3u8';
}

/**
 * @param {HTMLElement} container an empty element the viewer can fill
 * @return {{show: function, destroy: function}}
 */
export function createCameraViewer(container) {
  let dewarp = null;
  let hiddenVideo = null;
  let visibleVideo = null;
  let hls = null;
  // Set only by the public destroy() (not by the internal teardown() that show() also
  // calls to reset before rendering) - stops any pending retry from firing after the
  // viewer has actually been torn down for good.
  let stopped = false;

  function teardown() {
    if (dewarp) {
      dewarp.destroy();
      dewarp = null;
    }
    if (hls) {
      hls.destroy();
      hls = null;
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

    const url = buildHlsLLUrl(camera.streamId, camera.channelId);
    if (Hls.isSupported()) {
      hls = new Hls({lowLatencyMode: true});
      hls.on(Hls.Events.ERROR, function(event, data) {
        if (stopped || !data.fatal) {
          return;
        }
        // rtsp-to-web starts "on demand" streams lazily on first request, so the very
        // first load attempt often fails before the stream has actually started - and
        // real cameras can drop off the network transiently too. Keep retrying instead
        // of leaving the viewer permanently dead.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setTimeout(() => {
            if (!stopped && hls) {
              hls.startLoad();
            }
          }, RETRY_DELAY_MS);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setTimeout(() => {
            if (!stopped) {
              attachStream(videoEl, camera);
            }
          }, RETRY_DELAY_MS);
        }
      });
      hls.loadSource(url);
      hls.attachMedia(videoEl);
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari plays HLS natively, no hls.js needed.
      videoEl.src = url;
    } else {
      console.error('This browser does not support HLS playback.');
    }
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
      hiddenVideo.style.cssText = 'position:absolute; width:1px; height:1px; opacity:0; pointer-events:none;';
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
