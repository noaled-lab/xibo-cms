// Camera grid page - lists cameras (name/type), with a single switchable
// preview panel at the top (click "미리보기" on any row) and a link out to
// the full camera detail page. Only one viewer instance ever exists here,
// keeping the grid itself lightweight regardless of how many cameras exist.
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

let viewer = null;
let selectedCameraId = null;
let hasAutoSelected = false;
let cameraById = {};

function navigatePreview(direction) {
  const ids = $('#cameraTable tbody tr').map(function() {
    return $(this).attr('data-camera-id');
  }).get();
  if (ids.length === 0) {
    return;
  }

  let index = ids.indexOf(selectedCameraId);
  index = index === -1 ? 0 : (index + direction + ids.length) % ids.length;

  const camera = cameraById[ids[index]];
  if (camera) {
    selectCameraForPreview(camera);
  }
}

function selectCameraForPreview(camera) {
  const cameraId = camera.streamId + ':' + camera.channelId;
  selectedCameraId = cameraId;

  $('#cameraPreviewName').html(
    $('<strong>').text(camera.name || camera.channelId),
  ).append(
    $('<span>').addClass('badge ml-2 ' + (camera.type === 'fisheye' ? 'badge-info' : 'badge-secondary'))
      .text(CAMERA_TYPE_LABELS[camera.type] || CAMERA_TYPE_LABELS.standard),
  );
  $('#cameraPreviewStage').show();
  $('#cameraPreviewNav').show();

  const testVideoUrl = camera.hasTestVideo ? cameraTestVideoUrl.replace(':id', cameraId) : null;
  const handle = viewer.show({
    type: camera.type,
    mseUrl: camera.url,
    fisheyeParams: camera.fisheyeParams,
    testVideoUrl: testVideoUrl,
  });

  const isFisheye = camera.type === 'fisheye';
  $('#cameraPreviewControls').toggle(isFisheye);

  if (isFisheye) {
    const $flip = $('#previewFlip').off('change')
      .prop('checked', !!(camera.fisheyeParams && camera.fisheyeParams.flip));
    const $ccw = $('#previewCcw').off('change')
      .prop('checked', !!(camera.fisheyeParams && camera.fisheyeParams.ccw));

    const applyEphemeral = () => handle.setEphemeral({flip: $flip.is(':checked'), ccw: $ccw.is(':checked')});
    applyEphemeral();
    $flip.add($ccw).on('change', applyEphemeral);

    $('#previewPtzHint').text(handle.mode === 'ptz' ? ' 드래그: 팬/틸트 · 휠: 줌' : '');
  }

  $('#cameraTable tbody tr').removeClass('table-active');
  $('#cameraTable tbody tr[data-camera-id="' + cameraId + '"]').addClass('table-active');
}

function displayCameras(cameras) {
  if ($.fn.DataTable.isDataTable('#cameraTable')) {
    $('#cameraTable').DataTable().destroy();
  }

  cameraById = {};
  cameras.forEach(function(camera) {
    cameraById[camera.streamId + ':' + camera.channelId] = camera;
  });

  const tbody = $('#cameraTable tbody');
  tbody.empty();

  cameras.forEach(function(camera) {
    const cameraId = camera.streamId + ':' + camera.channelId;
    const row = $('<tr>').attr('data-camera-id', cameraId);

    row.append($('<td>').text(camera.name || camera.channelId));

    const typeLabel = CAMERA_TYPE_LABELS[camera.type] || CAMERA_TYPE_LABELS.standard;
    const badgeClass = camera.type === 'fisheye' ? 'badge-info' : 'badge-secondary';
    row.append(
      $('<td>').append($('<span>').addClass('badge ' + badgeClass).text(typeLabel)),
    );

    const actionCell = $('<td>');
    actionCell.append($('<button>', {
      'class': 'btn btn-sm btn-secondary mr-1',
      'type': 'button',
      'title': '미리보기',
    }).html('<i class="fa fa-play"></i> 미리보기').on('click', function() {
      selectCameraForPreview(camera);
    }));
    actionCell.append($('<a>', {
      'class': 'btn btn-sm btn-primary mr-1',
      'href': cameraDetailUrl.replace(':id', cameraId),
      'title': '상세보기',
    }).html('<i class="fa fa-eye"></i> 상세보기'));
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
  });

  $('#cameraTable').DataTable({
    'language': dataTableKoLanguage,
    'lengthChange': false,
    'searching': false,
    'paging': true,
    'info': true,
    'autoWidth': false,
    'order': [[0, 'asc']],
  });

  XiboInitialise('#cameraTable');

  if (selectedCameraId) {
    $('#cameraTable tbody tr[data-camera-id="' + selectedCameraId + '"]').addClass('table-active');
  } else if (!hasAutoSelected && cameras.length > 0) {
    hasAutoSelected = true;
    selectCameraForPreview(cameras[0]);
  }
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
  viewer = createCameraViewer(document.getElementById('cameraPreviewStage'));

  loadCameras();

  $('#cameraPreviewPrev').on('click', function() {
    navigatePreview(-1);
  });
  $('#cameraPreviewNext').on('click', function() {
    navigatePreview(1);
  });

  $('#refreshGrid').click(function() {
    refreshCameraList();
  });

  $(document).on('hidden.bs.modal', function() {
    refreshCameraList();
  });
});
