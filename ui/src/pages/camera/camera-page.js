// Camera grid page - lists cameras (name/type) and links out to the camera
// detail page for actually viewing video. Per-row video preview was removed
// so the grid stays lightweight; the detail page is the single place
// video (including fisheye dewarp) is rendered.
import {initCameraFisheyeCalibration} from './camera-edit-calibration.js';

// Exposed for the camera-form-edit.twig "cameraEditFormOpen" hook (the
// framework's standard convention for running JS when a form dialog opens).
window.initCameraFisheyeCalibration = initCameraFisheyeCalibration;

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

function displayCameras(cameras) {
  if ($.fn.DataTable.isDataTable('#cameraTable')) {
    $('#cameraTable').DataTable().destroy();
  }

  const tbody = $('#cameraTable tbody');
  tbody.empty();

  cameras.forEach(function(camera) {
    const cameraId = camera.streamId + ':' + camera.channelId;
    const row = $('<tr>');

    row.append($('<td>').text(camera.name || camera.channelId));

    const typeLabel = CAMERA_TYPE_LABELS[camera.type] || CAMERA_TYPE_LABELS.standard;
    const badgeClass = camera.type === 'fisheye' ? 'badge-info' : 'badge-secondary';
    row.append(
      $('<td>').append($('<span>').addClass('badge ' + badgeClass).text(typeLabel)),
    );

    const actionCell = $('<td>');
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
