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

let activeViewers = [];

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

  cameras.forEach(function(camera) {
    const cameraId = camera.streamId + ':' + camera.channelId;
    const row = $('<tr>').attr('data-camera-id', cameraId);

    row.append($('<td>').text(camera.name || camera.channelId));

    const typeLabel = CAMERA_TYPE_LABELS[camera.type] || CAMERA_TYPE_LABELS.standard;
    const badgeClass = camera.type === 'fisheye' ? 'badge-info' : 'badge-secondary';
    row.append(
      $('<td>').append($('<span>').addClass('badge ' + badgeClass).text(typeLabel)),
    );

    const previewStage = $('<div>').css({
      'background': '#000',
      'width': '240px',
      'max-width': '240px',
    })[0];
    row.append($('<td>').append(previewStage));

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

    const viewer = createCameraViewer(previewStage);
    const testVideoUrl = camera.hasTestVideo ? cameraTestVideoUrl.replace(':id', cameraId) : null;
    viewer.show({
      type: camera.type,
      streamId: camera.streamId,
      channelId: camera.channelId,
      fisheyeParams: camera.fisheyeParams,
      testVideoUrl: testVideoUrl,
    });
    activeViewers.push(viewer);
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
