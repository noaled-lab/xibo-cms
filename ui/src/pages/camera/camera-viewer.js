// Shared "camera viewer" - renders a single camera into a container element:
// a dewarped canvas for fisheye cameras, a plain <video> for standard ones.
// Used by both the camera detail page and the channel-list preview panel, so
// switching which camera is shown always behaves the same way.
import {createFisheyeDewarp} from './fisheye-dewarp.js';
import {startPlay, buildMseWebSocketUrl} from './camera-stream.js';

/**
 * @param {HTMLElement} container an empty element the viewer can fill
 * @return {{show: function, destroy: function}}
 */
export function createCameraViewer(container) {
  let dewarp = null;
  let hiddenVideo = null;
  let visibleVideo = null;
  let player = null;

  function teardown() {
    if (dewarp) {
      dewarp.destroy();
      dewarp = null;
    }
    if (player) {
      player.stop();
      player = null;
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

  /**
   * @param {object} camera {type, mseUrl, fisheyeParams, testVideoUrl}
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

      if (camera.testVideoUrl) {
        hiddenVideo.src = camera.testVideoUrl;
        hiddenVideo.play().catch(() => {});
      } else {
        player = startPlay(hiddenVideo, buildMseWebSocketUrl(camera.mseUrl));
      }

      dewarp.startLoop();

      return {
        setEphemeral: (ephemeral) => dewarp && dewarp.setEphemeral(ephemeral),
        mode: fisheyeParams.mode || 'seg',
      };
    }

    visibleVideo = document.createElement('video');
    visibleVideo.className = 'w-100';
    visibleVideo.controls = true;
    visibleVideo.autoplay = true;
    visibleVideo.muted = true;
    visibleVideo.playsInline = true;
    container.appendChild(visibleVideo);

    if (camera.testVideoUrl) {
      visibleVideo.src = camera.testVideoUrl;
    } else {
      player = startPlay(visibleVideo, buildMseWebSocketUrl(camera.mseUrl));
    }

    return {setEphemeral: () => {}, mode: null};
  }

  return {show, destroy: teardown};
}
