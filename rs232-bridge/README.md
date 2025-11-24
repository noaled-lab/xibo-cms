# RS-232 Bridge Server for Xibo CMS

RS-232 시리얼 데이터를 HTTP API로 변환하여 Xibo CMS의 Data Connector와 연동하는 브리지 서버입니다.

## 🚀 빠른 시작

### 1. 서버 실행
```bash
npm start
```

### 2. API 테스트
```bash
# 서버 상태 확인
curl http://localhost:3000/api/status

# RS-232 데이터 확인
curl http://localhost:3000/api/serial-data
```

## 📡 API 엔드포인트

- `GET /api/status` - 서버 상태 및 RS-232 연결 상태
- `GET /api/serial-data` - 최신 RS-232 데이터
- `GET /api/connect` - RS-232 포트 연결
- `GET /api/disconnect` - RS-232 포트 해제

## ⚙️ 설정

### RS-232 포트 설정
`server.js` 파일에서 다음 설정을 변경하세요:

```javascript
const SERIAL_PORT = 'COM1'; // Windows: COM1, COM2, COM3...
const BAUD_RATE = 9600;     // 보드레이트
```

### Linux/Mac 사용자
```javascript
const SERIAL_PORT = '/dev/ttyUSB0'; // 또는 /dev/ttyACM0
```

## 🔧 개발 모드

```bash
# nodemon으로 자동 재시작
npm install -g nodemon
npm run dev
```

## 📊 데이터 형식

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "rawData": "25.5",
  "value": 25.5,
  "status": "connected",
  "port": "COM1"
}
```

## 🎭 시뮬레이션 모드

RS-232 장비가 없을 때 자동으로 시뮬레이션 모드로 전환됩니다.
2초마다 랜덤 데이터를 생성합니다.

## 🔗 Xibo 연동

Xibo Data Connector에서 다음과 같이 사용:

```javascript
window.onInit = function() {
  setInterval(function() {
    xiboDC.makeRequest('http://localhost:3000/api/serial-data', {
      type: 'GET',
      done: function(status, data) {
        if (status === 200) {
          xiboDC.setData('serialData', JSON.stringify(data), {
            done: function() {
              xiboDC.notifyHost('serialData');
            }
          });
        }
      }
    });
  }, 1000);
}
```
