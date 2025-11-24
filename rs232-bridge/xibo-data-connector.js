// Xibo Data Connector JavaScript 코드
// 이 코드를 Xibo CMS의 Data Connector에 복사하여 사용하세요

window.onInit = function () {
  console.log('🚀 RS-232 Data Connector 초기화됨');

  // RS-232 브리지 서버 URL (실제 서버 주소로 변경)
  const BRIDGE_SERVER_URL = 'http://localhost:3000';

  // 데이터 수집 간격 (밀리초)
  const COLLECTION_INTERVAL = 1000; // 1초

  // 마지막 데이터 저장
  let lastData = null;
  let errorCount = 0;
  const MAX_ERRORS = 5;

  // RS-232 데이터 수집 함수
  function collectSerialData() {
    xiboDC.makeRequest(`${BRIDGE_SERVER_URL}/api/serial-data`, {
      type: 'GET',
      done: function (status, data) {
        if (status === 200) {
          try {
            // JSON 파싱
            const serialData = typeof data === 'string' ? JSON.parse(data) : data;

            // 데이터가 변경되었는지 확인
            if (!lastData || lastData.timestamp !== serialData.timestamp) {
              console.log('📡 새로운 RS-232 데이터:', serialData);

              // 데이터셋에 저장
              xiboDC.setData('serialData', JSON.stringify(serialData), {
                done: function () {
                  console.log('✅ RS-232 데이터 저장됨');
                  // 위젯들에게 알림
                  xiboDC.notifyHost('serialData');
                },
                error: function (error) {
                  console.error('❌ 데이터 저장 실패:', error);
                }
              });

              lastData = serialData;
              errorCount = 0; // 성공 시 에러 카운트 리셋
            }
          } catch (error) {
            console.error('❌ 데이터 파싱 오류:', error);
            handleError();
          }
        } else {
          console.error('❌ HTTP 요청 실패:', status);
          handleError();
        }
      },
      error: function (status, error) {
        console.error('❌ 네트워크 오류:', status, error);
        handleError();
      }
    });
  }

  // 에러 처리 함수
  function handleError() {
    errorCount++;
    console.warn(`⚠️ 에러 카운트: ${errorCount}/${MAX_ERRORS}`);

    if (errorCount >= MAX_ERRORS) {
      console.error('❌ 최대 에러 횟수 초과, 데이터 수집 중단');
      // 에러 상태 데이터 전송
      const errorData = {
        timestamp: new Date().toISOString(),
        rawData: 'ERROR',
        value: 0,
        status: 'error',
        port: 'DISCONNECTED',
        errorCount: errorCount
      };

      xiboDC.setData('serialData', JSON.stringify(errorData), {
        done: function () {
          xiboDC.notifyHost('serialData');
        }
      });

      // 30초 후 재시도
      setTimeout(() => {
        console.log('🔄 재시도 중...');
        errorCount = 0;
        collectSerialData();
      }, 30000);
    }
  }

  // 서버 상태 확인
  function checkServerStatus() {
    xiboDC.makeRequest(`${BRIDGE_SERVER_URL}/api/status`, {
      type: 'GET',
      done: function (status, data) {
        if (status === 200) {
          const statusData = typeof data === 'string' ? JSON.parse(data) : data;
          console.log('📊 서버 상태:', statusData);

          if (!statusData.serialConnected) {
            console.warn('⚠️ RS-232 포트 연결되지 않음');
          }
        }
      },
      error: function (status, error) {
        console.error('❌ 서버 상태 확인 실패:', error);
      }
    });
  }

  // 초기 서버 상태 확인
  checkServerStatus();

  // 주기적 데이터 수집 시작
  console.log(`🔄 RS-232 데이터 수집 시작 (${COLLECTION_INTERVAL}ms 간격)`);
  setInterval(collectSerialData, COLLECTION_INTERVAL);

  // 즉시 첫 데이터 수집
  collectSerialData();

  console.log('✅ RS-232 Data Connector 설정 완료');
}
