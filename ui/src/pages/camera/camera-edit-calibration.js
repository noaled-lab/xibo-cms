// Powers the camera Edit form (modal): the fisheye calibration panel (only
// shown/initialised when type=fisheye) and the test-video upload controls
// (always available, regardless of camera type). Calibration values here are
// the ones that get saved - this is the only screen where they can be
// changed. Detail-page overrides (flip/ccw while viewing) never touch this
// code.
import {createFisheyeDewarp} from './fisheye-dewarp.js';

const SLIDER_IDS = [
  'centerX', 'centerY', 'centerX2', 'centerY2', 'radius', 'radiusInner', 'radiusOuter',
  'rotationDeg', 'lensCorrection', 'fisheyeFov',
];
const SELECT_IDS = ['mode', 'layout', 'aspect'];

function readParamsFromForm($form) {
  const get = (id) => parseFloat($form.find('#' + id).val());
  const has = (id) => { const v = $form.find('#' + id).val(); return v !== undefined && v !== ''; };
  return {
    cx: get('centerX'),
    cy: get('centerY'),
    cx2: has('centerX2') ? get('centerX2') : undefined,
    cy2: has('centerY2') ? get('centerY2') : undefined,
    rad: get('radius'),
    rin: get('radiusInner'),
    rout: get('radiusOuter'),
    rot: get('rotationDeg'),
    lens: get('lensCorrection'),
    ffov: get('fisheyeFov'),
    mode: $form.find('#mode').val(),
    layout: $form.find('#layout').val(),
    aspect: get('aspect'),
  };
}

function readEphemeralFromForm($form) {
  return {
    flip: $form.find('#flip').is(':checked'),
    ccw: $form.find('#ccw').is(':checked'),
  };
}

export function initCameraFisheyeCalibration(dialog) {
  const $dialog = $(dialog);
  const $form = $dialog.find('#cameraEditForm');
  const $panel = $dialog.find('#fisheyeCalibration');
  const $typeSelect = $dialog.find('#type');

  let dewarp = null;
  let hiddenVideo = null;
  let mse = null;
  let stopped = false;

  function togglePanel() {
    const isFisheye = $typeSelect.val() === 'fisheye';
    $panel.toggle(isFisheye);
    if (isFisheye && !dewarp) {
      setupDewarp();
    }
  }

  // Refreshes the fisheye preview source (the live stream).
  // A no-op when the calibration panel/canvas isn't active (e.g. type is "standard").
  function loadSource() {
    if (!dewarp) {
      return;
    }

    const $status = $dialog.find('#fisheyePreviewStatus');

    if (hiddenVideo) {
      hiddenVideo.pause();
      hiddenVideo.remove();
    }
    hiddenVideo = document.createElement('video');
    hiddenVideo.muted = true;
    hiddenVideo.playsInline = true;
    hiddenVideo.autoplay = true;
    hiddenVideo.crossOrigin = 'anonymous';
    // Must be attached to the document (not just display:none) - browsers throttle decoding
    // of detached/display:none video elements, which causes dropped frames in the dewarped
    // canvas even though the video itself is never meant to be seen directly.
    hiddenVideo.style.cssText = 'position:absolute; width:1px; height:1px; opacity:0; pointer-events:none;';
    $dialog.find('#fisheyePreviewCanvas')[0].parentElement.appendChild(hiddenVideo);

    hiddenVideo.addEventListener('loadedmetadata', function() {
      dewarp.setSource(hiddenVideo, hiddenVideo.videoWidth, hiddenVideo.videoHeight, true);
      $status.text('');
    });

    $status.text('실시간 스트림을 불러오는 중...');
    
    // We import attachWhepStream from camera-viewer.js or implement here if not exported
    // Since we need to reuse it, we can just use the iframe / video approach or WHEP directly.
    // Wait, the preview in edit form is fisheye, so it needs WebRTC WHEP.
    // But camera-viewer.js's attachWhepStream isn't exported... oh wait, let's just make it exportable in camera-viewer.js later, or do it dynamically.
    // Actually, in the preview, we just want to play the stream. For Mediamtx WHEP, we can use the same logic.
    // Let's implement attachWhepStream inline or export it. Wait, I didn't export it in camera-viewer.js.
    // For now, let's just rely on a global or duplicate the WHEP connect logic for the preview?
    // Let's just create an iframe and use it as a source? No, iframe can't be used as a WebGL texture because of cross-origin/tainted canvas constraints unless the video element inside has crossOrigin set.
    // It's better to export `attachWhepStream` from `camera-viewer.js`. I will do that in the next step.
    
    import('./camera-viewer.js').then((module) => {
      if (module.attachWhepStream) {
        mse = module.attachWhepStream(hiddenVideo, $form.data('camera-id'));
      }
    });
  }

  function setupDewarp() {
    const canvas = $dialog.find('#fisheyePreviewCanvas')[0];
    const sourceCanvas = $dialog.find('#fisheyeSourceCanvas')[0];
    dewarp = createFisheyeDewarp(canvas, sourceCanvas);

    const initialParams = $form.data('fisheye-params') || {};
    dewarp.setParams(initialParams);
    dewarp.setEphemeral(readEphemeralFromForm($form));
    dewarp.onPanesChange((panes) => {
      $form.find('#panes').val(JSON.stringify(panes));
    });
    dewarp.onCenterPick((centers) => {
      if (centers.cx !== undefined) {
        $form.find('#centerX').val(centers.cx.toFixed(1));
        $form.find('#centerY').val(centers.cy.toFixed(1));
      }
      if (centers.cx2 !== undefined) {
        $form.find('#centerX2').val(centers.cx2.toFixed(1));
        $form.find('#centerY2').val(centers.cy2.toFixed(1));
      }
      dewarp.setParams(readParamsFromForm($form));
    });

    SLIDER_IDS.concat(SELECT_IDS).forEach((id) => {
      $form.find('#' + id).on('input change', () => {
        dewarp.setParams(readParamsFromForm($form));
      });
    });
    $form.find('#flip, #ccw').on('change', () => {
      dewarp.setEphemeral(readEphemeralFromForm($form));
    });

    dewarp.startLoop();
    loadSource();
  }

  togglePanel();
  $typeSelect.off('change.cameraFisheye').on('change.cameraFisheye', togglePanel);

  $dialog.one('hidden.bs.modal', function() {
    stopped = true;
    if (dewarp) {
      dewarp.destroy();
    }
    if (mse) {
      mse.destroy();
    }
    if (hiddenVideo) {
      hiddenVideo.remove();
    }
  });
}
