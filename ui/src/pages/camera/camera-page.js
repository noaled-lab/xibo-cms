// Camera grid page - lists cameras (name/type) with a live preview inline on
// every row (each row gets its own viewer, so multiple cameras can play at
// the same time), plus a link out to the full camera detail page.
import {initCameraFisheyeCalibration} from './camera-edit-calibration.js';
import {createCameraViewer} from './camera-viewer.js';

// Invoked by the framework via the form's "callBack" block (see
// camera-form-edit.twig's {% block callBack %}cameraEditFormOpen{% endblock %})
// once the edit dialog's HTML has been inserted into the page.
window.cameraEditFormOpen = initCameraFisheyeCalibration;

const dataTableKoLanguage = {
  'sEmptyTable': '등록된 카메라가 없습니다.',
  'sInfo': '총 _TOTAL_개 중 _START_에서 _END_까지 표시',
  'sInfoEmpty': '0개 항목',
  'sInfoFiltered': '(전체 _MAX_개 중 검색됨)',
  'sLengthMenu': '_MENU_개씩 표시',
  'sLoadingRecords': '로딩중...',
  'sProcessing': '처리중...',
  'sSearch': '검색:',
  'sZeroRecords': '검색 결과가 없습니다.',
  'oPaginate': {
    'sFirst': '처음',
    'sLast': '마지막',
    'sNext': '다음',
    'sPrevious': '이전',
  },
  'oAria': {
    'sSortAscending': ': 오름차순 정렬',
    'sSortDescending': ': 내림차순 정렬',
  },
};

const CAMERA_TYPE_LABELS = {
  standard: '일반',
  fisheye: '어안',
};

const PREVIEW_SMALL_WIDTH = '240px';
// "Large" fills the width of the (now generously percentage-sized, see camera-page.twig's
// #cameraTable column widths) preview column in place - no popup, no overlay. Since that
// column is a percentage of the table width, this naturally scales up on a bigger monitor.
const PREVIEW_COLLAPSED_CSS = {'width': PREVIEW_SMALL_WIDTH, 'max-width': PREVIEW_SMALL_WIDTH};
const PREVIEW_EXPANDED_CSS = {'width': '100%', 'max-width': '100%'};

const DRAG_THRESHOLD_PX = 5;

// Fisheye panorama/PTZ previews support drag-to-pan (see fisheye-dewarp.js) on the
// same element we want a plain click to open the bigger dialog - a naive 'click'
// handler fires at the end of a drag too (pointerup lands back near the target), which
// hijacked panning into constantly popping the dialog open. Only treat it as a click if
// the pointer barely moved between down and up.
function bindClickWithoutDrag($el, handler) {
  let startX = 0;
  let startY = 0;
  let moved = false;

  $el.on('pointerdown', function(e) {
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
  }).on('pointermove', function(e) {
    if (Math.abs(e.clientX - startX) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - startY) > DRAG_THRESHOLD_PX) {
      moved = true;
    }
  }).on('pointerup', function(e) {
    if (!moved) {
      handler(e);
    }
  });
}

let activeViewers = [];

function cameraPayload(camera, testVideoUrl) {
  return {
    type: camera.type,
    streamId: camera.streamId,
    channelId: camera.channelId,
    fisheyeParams: camera.fisheyeParams,
    testVideoUrl: testVideoUrl,
  };
}

// Opens the same camera much larger in a dialog - a separate viewer instance, so it
// plays independently of (and doesn't disturb) the row's own inline preview.
let dialogStageCounter = 0;

function openPreviewDialog(camera, testVideoUrl) {
  // bootbox inserts `message` via jQuery .html(), which only accepts a string (a
  // jQuery/DOM object passed directly gets stringified into garbage) - so build the
  // stage as markup and look it up again once it's actually in the DOM.
  const stageId = 'cameraPreviewDialogStage' + (dialogStageCounter++);
  const dialog = bootbox.dialog({
    title: camera.name || camera.channelId,
    message: '<div id="' + stageId + '" style="background:#000; width:100%;"></div>',
    size: 'extra-large',
    backdrop: true, // click outside the dialog to close it
  });

  let dialogViewer = null;
  // Wait for the modal's own "fully shown" event before measuring/creating the viewer -
  // creating it earlier (while the modal is still animating in) reads a stale/incorrect
  // width from the still-transitioning dialog, which shows up as a cropped or
  // oddly-sized video.
  dialog.one('shown.bs.modal', function() {
    const stage = dialog.find('#' + stageId)[0];
    dialogViewer = createCameraViewer(stage);
    dialogViewer.show(cameraPayload(camera, testVideoUrl));
  });

  // stopPropagation so this pure-viewing dialog doesn't trigger the page's global
  // hidden.bs.modal handler (below) meant for the add/edit/delete forms - that would
  // refresh and rebuild the whole grid, tearing down every row's live preview.
  dialog.one('hidden.bs.modal', function(e) {
    e.stopPropagation();
    if (dialogViewer) {
      dialogViewer.destroy();
    }
  });
}

function displayCameras(cameras) {
  if ($.fn.DataTable.isDataTable('#cameraTable')) {
    $('#cameraTable').DataTable().destroy();
  }

  // Tear down any viewers from the previous render (hls.js instances, WebGL contexts)
  // before rebuilding the table, so they don't keep streaming in the background.
  activeViewers.forEach((viewer) => viewer.destroy());
  activeViewers = [];

  const tbody = $('#cameraTable tbody');
  tbody.empty();

  // Viewers are created once the table has finished laying out (DataTable's
  // initComplete, below) rather than right here - creating them immediately after
  // inserting the row measures the preview container before DataTables has sorted/
  // sized the table, which reads a stale width and shows up as a black/broken preview
  // until something else (opening the dialog, a page refresh) forces a fresh layout.
  const pending = [];

  cameras.forEach(function(camera) {
    const cameraId = camera.streamId + ':' + camera.channelId;
    const row = $('<tr>').attr('data-camera-id', cameraId);

    row.append($('<td>').text(camera.name || camera.channelId));

    const typeLabel = CAMERA_TYPE_LABELS[camera.type] || CAMERA_TYPE_LABELS.standard;
    const badgeClass = camera.type === 'fisheye' ? 'badge-info' : 'badge-secondary';
    row.append(
      $('<td>').append($('<span>').addClass('badge ' + badgeClass).text(typeLabel)),
    );

    const testVideoUrl = camera.hasTestVideo ? cameraTestVideoUrl.replace(':id', cameraId) : null;

    let viewer = null;
    const $previewWrapper = $('<div>').css({'position': 'relative'}).css(PREVIEW_COLLAPSED_CSS);
    const $previewStage = $('<div>').css({'background': '#000', 'cursor': 'pointer'})
      .attr('title', '크게 보기');
    bindClickWithoutDrag($previewStage, function() {
      openPreviewDialog(camera, testVideoUrl);
    });
    const $sizeBtn = $('<button>', {
      'class': 'btn btn-sm btn-secondary',
      'type': 'button',
      'title': '작게/크게',
      'style': 'position:absolute; top:4px; right:4px; z-index:10;',
    }).html('<i class="fa fa-expand"></i>').on('click', function(e) {
      e.stopPropagation();
      const expanded = $previewWrapper.data('expanded');
      $previewWrapper.css(expanded ? PREVIEW_COLLAPSED_CSS : PREVIEW_EXPANDED_CSS);
      $previewWrapper.data('expanded', !expanded);
      $sizeBtn.html('<i class="fa fa-' + (expanded ? 'expand' : 'compress') + '"></i>');
      if (viewer) {
        viewer.resize();
      }
    });
    $previewWrapper.append($previewStage).append($sizeBtn);
    row.append($('<td>').append($previewWrapper));

    const actionCell = $('<td>');
    actionCell.append($('<a>', {
      'class': 'btn btn-sm btn-primary mr-1',
      'href': cameraDetailUrl.replace(':id', cameraId),
      'title': '상세보기',
    }).html('<i class="fa fa-eye"></i>'));
    actionCell.append($('<button>', {
      'class': 'btn btn-sm btn-warning XiboFormButton mr-1',
      'href': cameraEditFormUrl.replace(':id', cameraId),
      'title': '수정',
    }).html('<i class="fa fa-edit"></i>'));
    actionCell.append($('<button>', {
      'class': 'btn btn-sm btn-danger XiboFormButton',
      'href': cameraDeleteFormUrl.replace(':id', cameraId),
      'title': '삭제',
    }).html('<i class="fa fa-trash"></i>'));
    row.append(actionCell);

    tbody.append(row);

    pending.push({
      stage: $previewStage[0],
      start: (createdViewer) => {
        viewer = createdViewer;
      },
      camera: camera,
      testVideoUrl: testVideoUrl,
    });
  });

  $('#cameraTable').DataTable({
    'language': dataTableKoLanguage,
    'lengthChange': false,
    'searching': false,
    'paging': true,
    'info': true,
    'autoWidth': false,
    'order': [[0, 'asc']],
    'initComplete': function() {
      pending.forEach(({stage, start, camera, testVideoUrl}) => {
        const viewer = createCameraViewer(stage);
        start(viewer);
        viewer.show(cameraPayload(camera, testVideoUrl));
        activeViewers.push(viewer);
      });
    },
  });

  XiboInitialise('#cameraTable');
}

function loadCameras() {
  $.ajax({
    url: cameraGridUrl,
    type: 'GET',
    dataType: 'json',
    cache: false,
    data: {
      _: new Date().getTime(),
    },
    success: function(response) {
      displayCameras(response.data || []);
    },
    error: function(_xhr, status, error) {
      console.error('Failed to load cameras:', status, error);
      displayCameras([]);
    },
  });
}

window.refreshCameraList = function() {
  loadCameras();
};

$(function() {
  loadCameras();

  $('#refreshGrid').click(function() {
    refreshCameraList();
  });

  $(document).on('hidden.bs.modal', function() {
    refreshCameraList();
  });
});
