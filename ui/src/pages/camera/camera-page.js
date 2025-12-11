// Camera page JavaScript
var videoPlayers = {}; // 비디오 플레이어 참조 저장 (전역)

// 비디오 크기 토글 함수 (전역)
function toggleVideoSize(wrapper, button) {
    const isExpanded = wrapper.data('expanded');

    if (isExpanded) {
        // 축소
        wrapper.css({
            'width': '320px',
            'position': 'relative'
        });
        wrapper.data('expanded', false);
        button.html('<i class="fa fa-expand"></i>');
        button.attr('title', '크게 보기');
    } else {
        // 확대
        wrapper.css({
            'width': '100%',
            'position': 'relative'
        });
        wrapper.data('expanded', true);
        button.html('<i class="fa fa-compress"></i>');
        button.attr('title', '작게 보기');
    }
}

// MSE 비디오 재생 헬퍼 함수 (전역)
function Utf8ArrayToStr(array) {
    try {
        return new TextDecoder('utf-8').decode(array);
    } catch (e) {
        let out = '';
        for (let i = 0; i < array.length; ++i) {
            out += String.fromCharCode(array[i]);
        }
        return out;
    }
}

// MSE 비디오 재생 함수 (전역)
function startPlay(videoEl, url) {
    const mseQueue = [];
    let mseSourceBuffer = null;
    let mseStreamingStarted = false;
    let ws = null;
    let objectUrl = null;

    const mse = new MediaSource();
    objectUrl = window.URL.createObjectURL(mse);
    videoEl.src = objectUrl;

    function pushPacket() {
        let packet;
        if (!mseSourceBuffer) return;
        if (!mseSourceBuffer.updating) {
            if (mseQueue.length > 0) {
                packet = mseQueue.shift();
                try {
                    mseSourceBuffer.appendBuffer(packet);
                } catch (e) {
                    console.error('appendBuffer error:', e);
                }
            } else {
                mseStreamingStarted = false;
            }
        }
        try {
            if (videoEl.buffered.length > 0) {
                if (typeof document.hidden !== 'undefined' && document.hidden) {
                    videoEl.currentTime = videoEl.buffered.end((videoEl.buffered.length - 1)) - 0.5;
                }
            }
        } catch (e) {
            console.error('buffered error:', e);
        }
    }

    function readPacket(packet) {
        if (!mseSourceBuffer) {
            mseQueue.push(packet);
            return;
        }
        if (!mseStreamingStarted) {
            try {
                mseSourceBuffer.appendBuffer(packet);
            } catch (e) {
                console.error('appendBuffer error:', e);
            }
            mseStreamingStarted = true;
            return;
        }
        mseQueue.push(packet);
        if (!mseSourceBuffer.updating) {
            pushPacket();
        }
    }

    mse.addEventListener('sourceopen', function() {
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';

        ws.onopen = function() {
            console.log('WebSocket connected:', url);
        };

        ws.onmessage = function(event) {
            const data = new Uint8Array(event.data);
            if (data[0] === 9) {
                let mimeCodec;
                const decodedArr = data.slice(1);
                if (window.TextDecoder) {
                    mimeCodec = new TextDecoder('utf-8').decode(decodedArr);
                } else {
                    mimeCodec = Utf8ArrayToStr(decodedArr);
                }
                try {
                    mseSourceBuffer = mse.addSourceBuffer('video/mp4; codecs="' + mimeCodec + '"');
                    mseSourceBuffer.mode = 'segments';
                    mseSourceBuffer.addEventListener('updateend', pushPacket);
                } catch (err) {
                    console.error('addSourceBuffer failed:', err);
                }
            } else {
                readPacket(event.data);
            }
        };

        ws.onclose = function() {
            console.log('WebSocket closed');
        };

        ws.onerror = function(e) {
            console.error('WebSocket error:', e);
        };
    }, false);

    // fix stalled video in safari
    videoEl.addEventListener('pause', function() {
        if (videoEl.buffered.length > 0 &&
            videoEl.currentTime > videoEl.buffered.end(videoEl.buffered.length - 1)) {
            videoEl.currentTime = videoEl.buffered.end(videoEl.buffered.length - 1) - 0.1;
            videoEl.play();
        }
    });

    return {
        stop: function() {
            try { if (ws) ws.close(); } catch (e) {}
            try { videoEl.removeAttribute('src'); videoEl.load(); } catch (e) {}
            try { if (objectUrl) URL.revokeObjectURL(objectUrl); } catch (e) {}
        }
    };
}

// 카메라 목록 표시 함수 (전역)
function displayCameras(cameras) {
    console.log('Displaying cameras:', cameras.length);

    // DataTable을 먼저 파괴
    if ($.fn.DataTable.isDataTable('#cameraTable')) {
        console.log('Destroying existing DataTable');
        $('#cameraTable').DataTable().destroy();
    }

    // 그 다음 tbody 비우기
    const tbody = $('#cameraTable tbody');
    tbody.empty();
    console.log('Tbody cleared');

    if (cameras.length === 0) {
        console.log('No cameras to display');
        // DataTable 초기화 (빈 테이블)
        $('#cameraTable').DataTable({
            "language": {
                "sEmptyTable": "등록된 카메라가 없습니다.",
                "sInfo": "총 _TOTAL_개 중 _START_에서 _END_까지 표시",
                "sInfoEmpty": "0개 항목",
                "sInfoFiltered": "(전체 _MAX_개 중 검색됨)",
                "sLengthMenu": "_MENU_개씩 표시",
                "sLoadingRecords": "로딩중...",
                "sProcessing": "처리중...",
                "sSearch": "검색:",
                "sZeroRecords": "검색 결과가 없습니다.",
                "oPaginate": {
                    "sFirst": "처음",
                    "sLast": "마지막",
                    "sNext": "다음",
                    "sPrevious": "이전"
                },
                "oAria": {
                    "sSortAscending": ": 오름차순 정렬",
                    "sSortDescending": ": 내림차순 정렬"
                }
            },
            "lengthChange": false,
            "searching": false,
            "paging": true,
            "info": true,
            "autoWidth": false,
            "order": [[0, "asc"]]
        });
        return;
    }

    cameras.forEach(function(camera, index) {
        console.log('Adding camera row', index + 1, ':', camera.name, '(', camera.streamId + ':' + camera.channelId, ')');
        const row = $('<tr>');
        const cameraId = camera.streamId + ':' + camera.channelId;

        // 채널 이름
        const nameCell = $('<td>').text(camera.name || camera.channelId);

        // 실시간 영상
        const videoCell = $('<td>');
        const videoWrapper = $('<div>').css({
            'position': 'relative',
            'width': '320px',
            'background': '#000',
            'display': 'inline-block'
        });

        const video = $('<video>', {
            'id': 'camera-video-' + cameraId.replace(':', '-'),
            'controls': true,
            'autoplay': true,
            'muted': true,
            'playsinline': true,
            'style': 'width: 100%; height: auto; display: block; background: #000;'
        });

        // 확대 버튼 추가
        const expandBtn = $('<button>', {
            'class': 'btn btn-sm btn-info video-expand-btn',
            'title': '크게 보기',
            'style': 'position: absolute; top: 5px; right: 5px; z-index: 10;'
        }).html('<i class="fa fa-expand"></i>');

        expandBtn.on('click', function() {
            toggleVideoSize(videoWrapper, expandBtn);
        });

        videoWrapper.append(video).append(expandBtn);
        videoCell.append(videoWrapper);

        // 동작 버튼
        const actionCell = $('<td>');
        const editBtn = $('<button>', {
            'class': 'btn btn-sm btn-warning XiboFormButton mr-1',
            'href': cameraEditFormUrl.replace(':id', cameraId),
            'title': '수정'
        }).html('<i class="fa fa-edit"></i>');

        const deleteBtn = $('<button>', {
            'class': 'btn btn-sm btn-danger XiboFormButton',
            'href': cameraDeleteFormUrl.replace(':id', cameraId),
            'title': '삭제'
        }).html('<i class="fa fa-trash"></i>');

        actionCell.append(editBtn).append(' ').append(deleteBtn);

        row.append(nameCell).append(videoCell).append(actionCell);
        tbody.append(row);
    });

    console.log('All rows added to tbody. Total rows in tbody:', tbody.find('tr').length);

    // DataTable 초기화
    console.log('Initializing DataTable...');
    $('#cameraTable').DataTable({
        "language": {
            "sEmptyTable": "등록된 카메라가 없습니다.",
            "sInfo": "총 _TOTAL_개 중 _START_에서 _END_까지 표시",
            "sInfoEmpty": "0개 항목",
            "sInfoFiltered": "(전체 _MAX_개 중 검색됨)",
            "sLengthMenu": "_MENU_개씩 표시",
            "sLoadingRecords": "로딩중...",
            "sProcessing": "처리중...",
            "sSearch": "검색:",
            "sZeroRecords": "검색 결과가 없습니다.",
            "oPaginate": {
                "sFirst": "처음",
                "sLast": "마지막",
                "sNext": "다음",
                "sPrevious": "이전"
            },
            "oAria": {
                "sSortAscending": ": 오름차순 정렬",
                "sSortDescending": ": 내림차순 정렬"
            }
        },
        "lengthChange": false,
        "searching": false,
        "paging": true,
        "info": true,
        "autoWidth": false,
        "order": [[0, "asc"]]
    });

    // XiboFormButton 이벤트 바인딩
    XiboInitialise('#cameraTable');

    // 비디오 재생 시작
    setTimeout(function() {
        console.log('Starting video playback for', cameras.length, 'cameras');
        cameras.forEach(function(camera) {
            const cameraId = camera.streamId + ':' + camera.channelId;
            const videoEl = document.getElementById('camera-video-' + cameraId.replace(':', '-'));
            if (videoEl && camera.url) {
                if (!videoPlayers[cameraId]) {
                    console.log('Starting video for camera:', cameraId);
                    videoPlayers[cameraId] = startPlay(videoEl, camera.url);
                } else {
                    console.log('Video already playing for camera:', cameraId);
                }
            }
        });
    }, 300);
}

// 카메라 목록 로드 함수 (전역)
function loadCameras() {
    console.log('Loading cameras from API:', cameraGridUrl);
    $.ajax({
        url: cameraGridUrl,
        type: 'GET',
        dataType: 'json',
        cache: false, // 캐시 비활성화
        data: {
            _: new Date().getTime() // 캐시 무효화를 위한 타임스탬프
        },
        success: function(response) {
            console.log('API response received:', response);
            displayCameras(response.data || []);
        },
        error: function(_xhr, status, error) {
            console.error('Failed to load cameras:', status, error);
            displayCameras([]);
        }
    });
}

// 카메라 목록 새로고침 함수 (전역)
window.refreshCameraList = function() {
    console.log('Refreshing camera list...');
    // 기존 비디오 플레이어 정리
    Object.keys(videoPlayers).forEach(function(key) {
        if (videoPlayers[key] && videoPlayers[key].stop) {
            videoPlayers[key].stop();
        }
    });
    videoPlayers = {};

    // 카메라 목록 다시 로드 (API 호출)
    loadCameras();
};

$(function() {
    loadCameras();

    // 리프레시 버튼 클릭 이벤트
    $('#refreshGrid').click(function() {
        console.log('Refresh button clicked');
        refreshCameraList();
    });

    // 부트스트랩 모달이 닫힐 때 리프레시
    $(document).on('hidden.bs.modal', function() {
        console.log('Modal closed, refreshing camera list');
        refreshCameraList();
    });
});