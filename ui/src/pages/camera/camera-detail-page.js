// Camera detail page - the single place a camera's video (including fisheye
// dewarp) is actually rendered. Flip/ccw here are session-only overrides on
// top of the saved defaults from the camera Edit form; they are never sent
// back to the server.
import {createFisheyeDewarp} from './fisheye-dewarp.js';
import {startPlay} from './camera-stream.js';

$(function() {
  const $root = $('#cameraDetail');
  if ($root.length === 0) {
    return;
  }

  const cameraType = $root.data('camera-type');
  const mseUrl = $root.data('mse-url');
  const testVideoUrl = $root.data('test-video-download-url');
  const wsUrl = 'ws://' + window.location.hostname + ':8083' + mseUrl;

  if (cameraType === 'fisheye') {
    const fisheyeParams = $root.data('fisheye-params') || {};
    const canvas = document.getElementById('cameraDewarpCanvas');
    const dewarp = createFisheyeDewarp(canvas);

    dewarp.setParams(fisheyeParams);

    const $flip = $('#viewFlip').prop('checked', !!fisheyeParams.flip);
    const $ccw = $('#viewCcw').prop('checked', !!fisheyeParams.ccw);
    dewarp.setEphemeral({flip: $flip.is(':checked'), ccw: $ccw.is(':checked')});

    $flip.add($ccw).on('change', function() {
      // Session-only: never persisted.
      dewarp.setEphemeral({flip: $flip.is(':checked'), ccw: $ccw.is(':checked')});
    });

    if (fisheyeParams.mode === 'ptz') {
      $('#viewPtzHint').text(' 드래그: 팬/틸트 · 휠: 줌');
    }

    const hiddenVideo = document.createElement('video');
    hiddenVideo.muted = true;
    hiddenVideo.playsInline = true;
    hiddenVideo.autoplay = true;
    hiddenVideo.addEventListener('loadedmetadata', function() {
      dewarp.setSource(hiddenVideo, hiddenVideo.videoWidth, hiddenVideo.videoHeight, true);
    });

    if (testVideoUrl) {
      hiddenVideo.src = testVideoUrl;
      hiddenVideo.play().catch(() => {});
    } else {
      startPlay(hiddenVideo, wsUrl);
    }

    dewarp.startLoop();
  } else {
    const videoEl = document.getElementById('cameraStandardVideo');
    if (testVideoUrl) {
      videoEl.src = testVideoUrl;
    } else {
      startPlay(videoEl, wsUrl);
    }
  }
});
