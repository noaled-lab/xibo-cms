// Powers the camera Edit form (modal): the fisheye calibration panel (only
// shown/initialised when type=fisheye) and the test-video upload controls
// (always available, regardless of camera type). Calibration values here are
// the ones that get saved - this is the only screen where they can be
// changed. Detail-page overrides (flip/ccw while viewing) never touch this
// code.
import Hls from 'hls.js';
import {createFisheyeDewarp} from './fisheye-dewarp.js';
import {HLS_CONFIG} from './camera-viewer.js';

const RETRY_DELAY_MS = 4000;

function buildHlsLLUrl(cameraId) {
  const [streamId, channelId] = cameraId.split(':');
  return window.location.protocol + '//' + window.location.hostname + ':8083' +
    '/stream/' + streamId + '/channel/' + channelId + '/hlsll/live/index.m3u8';
}

const SLIDER_IDS = [
  'centerX', 'centerY', 'radius', 'radiusInner', 'radiusOuter',
  'rotationDeg', 'lensCorrection', 'fisheyeFov',
];
const SELECT_IDS = ['mode', 'layout', 'aspect'];

function readParamsFromForm($form) {
  const get = (id) => parseFloat($form.find('#' + id).val());
  return {
    cx: get('centerX'),
    cy: get('centerY'),
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
  let hls = null;
  let stopped = false;

  function togglePanel() {
    const isFisheye = $typeSelect.val() === 'fisheye';
    $panel.toggle(isFisheye);
    if (isFisheye && !dewarp) {
      setupDewarp();
    }
  }

  // Refreshes the fisheye preview source (test video, if one is set, otherwise the live stream).
  // A no-op when the calibration panel/canvas isn't active (e.g. type is "standard") - test-video
  // upload/delete still work in that case, there's just no preview to refresh.
  function loadSource() {
    if (!dewarp) {
      return;
    }

    const testVideoFile = $form.data('test-video-file');
    const $status = $dialog.find('#fisheyePreviewStatus');

    if (hiddenVideo) {
      hiddenVideo.pause();
      hiddenVideo.remove();
    }
    if (hls) {
      try {
        hls.destroy();
      } catch (e) {
        console.warn('Error tearing down HLS instance (ignored):', e);
      }
      hls = null;
    }
    hiddenVideo = document.createElement('video');
    hiddenVideo.muted = true;
    hiddenVideo.playsInline = true;
    hiddenVideo.autoplay = true;
    // Must be attached to the document (not just display:none) - browsers throttle decoding
    // of detached/display:none video elements, which causes dropped frames in the dewarped
    // canvas even though the video itself is never meant to be seen directly.
    hiddenVideo.style.cssText = 'position:absolute; width:1px; height:1px; opacity:0; pointer-events:none;';
    $dialog.find('#fisheyePreviewCanvas')[0].parentElement.appendChild(hiddenVideo);

    hiddenVideo.addEventListener('loadedmetadata', function() {
      dewarp.setSource(hiddenVideo, hiddenVideo.videoWidth, hiddenVideo.videoHeight, true);
      $status.text('');
    });

    if (testVideoFile) {
      $status.text('테스트 영상을 불러오는 중...');
      hiddenVideo.src = $form.data('test-video-download-url') + '?_=' + Date.now();
      hiddenVideo.play().catch(() => {});
    } else {
      $status.text('실시간 스트림(LL-HLS)을 불러오는 중...');
      const url = buildHlsLLUrl($form.data('camera-id'));
      if (Hls.isSupported()) {
        hls = new Hls(HLS_CONFIG);
        hls.on(Hls.Events.ERROR, function(event, data) {
          if (stopped || !data.fatal) {
            return;
          }
          // The stream may not have started yet (rtsp-to-web starts on-demand streams
          // lazily) - hls.js's startLoad()/recoverMediaError() don't reliably recover
          // from a failed *manifest* load, so just do what a page refresh does: tear
          // down and reload the source from scratch.
          setTimeout(() => {
            if (!stopped) {
              loadSource();
            }
          }, RETRY_DELAY_MS);
        });
        hls.loadSource(url);
        hls.attachMedia(hiddenVideo);
      } else if (hiddenVideo.canPlayType('application/vnd.apple.mpegurl')) {
        hiddenVideo.src = url;
      } else {
        $status.text('이 브라우저는 HLS 재생을 지원하지 않습니다.');
      }
    }
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
    dewarp.onCenterPick(({cx, cy}) => {
      $form.find('#centerX').val(cx.toFixed(1));
      $form.find('#centerY').val(cy.toFixed(1));
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

  // Test-video upload/delete are wired unconditionally - useful for standard cameras too
  // (verifying the detail page plays something without a live camera connected).
  function wireTestVideoControls() {
    $dialog.find('#testVideoUploadBtn').on('click', function() {
      const fileInput = $dialog.find('#testVideoInput')[0];
      if (!fileInput.files.length) {
        SystemMessage('업로드할 파일을 선택하세요.', true);
        return;
      }
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);

      $.ajax({
        url: $form.data('test-video-upload-url'),
        type: 'POST',
        data: formData,
        processData: false,
        contentType: false,
        success: function(res) {
          if (res.success) {
            $form.data('test-video-file', 'uploaded');
            loadSource();
          }
          SystemMessage(res.message, !res.success);
        },
      });
    });

    $dialog.find('#testVideoDeleteBtn').on('click', function() {
      $.ajax({
        url: $form.data('test-video-delete-url'),
        type: 'DELETE',
        success: function(res) {
          if (res.success) {
            $form.data('test-video-file', '');
            loadSource();
          }
          SystemMessage(res.message, !res.success);
        },
      });
    });
  }

  wireTestVideoControls();
  togglePanel();
  $typeSelect.off('change.cameraFisheye').on('change.cameraFisheye', togglePanel);

  $dialog.one('hidden.bs.modal', function() {
    stopped = true;
    if (dewarp) {
      dewarp.destroy();
    }
    if (hls) {
      try {
        hls.destroy();
      } catch (e) {
        console.warn('Error tearing down HLS instance (ignored):', e);
      }
    }
    if (hiddenVideo) {
      hiddenVideo.remove();
    }
  });
}
