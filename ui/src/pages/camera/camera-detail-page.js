// Camera detail page - the single place a camera's video (including fisheye
// dewarp) is actually rendered. Flip/ccw here are session-only overrides on
// top of the saved defaults from the camera Edit form; they are never sent
// back to the server.
import {createCameraViewer} from './camera-viewer.js';

$(function() {
  const $root = $('#cameraDetail');
  if ($root.length === 0) {
    return;
  }

  const camera = {
    type: $root.data('camera-type'),
    channelId: $root.data('channel-id'),
    fisheyeParams: $root.data('fisheye-params') || null,
  };

  const viewer = createCameraViewer(document.getElementById('cameraViewerStage'));
  const handle = viewer.show(camera);

  if (camera.type === 'fisheye') {
    const $flip = $('#viewFlip').prop('checked', !!camera.fisheyeParams.flip);
    const $ccw = $('#viewCcw').prop('checked', !!camera.fisheyeParams.ccw);
    handle.setEphemeral({flip: $flip.is(':checked'), ccw: $ccw.is(':checked')});

    $flip.add($ccw).on('change', function() {
      // Session-only: never persisted.
      handle.setEphemeral({flip: $flip.is(':checked'), ccw: $ccw.is(':checked')});
    });

    if (handle.mode === 'ptz') {
      $('#viewPtzHint').text(' 드래그: 팬/틸트 · 휠: 줌');
    }
  }
});
