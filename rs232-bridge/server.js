const express = require('express');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const app = express();
const port = 3000;

// CORS 설정 (Xibo에서 요청할 수 있도록)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// JSON 파싱 미들웨어
app.use(express.json());

// RS-232 포트 설정 (Windows: COM1, COM2 등, Linux/Mac: /dev/ttyUSB0 등)
const SERIAL_PORT = 'COM5'; // COM2로 시도 (HHD Software Bridged Serial Port)
const BAUD_RATE = 38400; // 접점 보드 실제 보드레이트 (제작자 확인)

let serialPort = null;
let latestData = null;
let isConnected = false;

// RS-232 포트 초기화
function initSerialPort() {
  try {
    serialPort = new SerialPort({
      path: SERIAL_PORT,
      baudRate: BAUD_RATE,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      flowControl: false
    });

    // 원시 데이터 수신 (ReadlineParser 제거)
    // const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    serialPort.on('open', () => {
      console.log(`✅ RS-232 포트 연결됨: ${SERIAL_PORT} (${BAUD_RATE} baud)`);
      isConnected = true;
    });

    serialPort.on('error', (err) => {
      console.error('❌ RS-232 포트 오류:', err.message);
      isConnected = false;
    });

    serialPort.on('close', () => {
      console.log('⚠️ RS-232 포트 연결 끊어짐');
      isConnected = false;
    });

    // 원시 데이터 수신 처리
    serialPort.on('data', (data) => {
      // Buffer를 문자열로 변환
      const dataString = data.toString('utf8');

      console.log('📡 RS-232 데이터 수신 (원본):', JSON.stringify(data));
      console.log('📡 RS-232 데이터 수신 (문자열):', dataString);
      console.log('📡 RS-232 데이터 수신 (길이):', data.length);
      console.log('📡 RS-232 데이터 수신 (바이트):', data);
      console.log('📡 RS-232 데이터 수신 (16진수):', data.toString('hex'));
      console.log('📡 RS-232 데이터 수신 (ASCII):', Array.from(data).join(','));

      // 접점 보드 데이터 파싱 (스위치 상태 확인)
      const rawData = dataString.trim();
      let switchStates = {};

      // 접점 보드 데이터 파싱: $R,1,0,1,0*5C 형식
      if (rawData.startsWith('$R,') && rawData.includes('*')) {
        // $R,1,0,1,0*5C 형식 파싱
        const parts = rawData.split('*');
        if (parts.length >= 1) {
          const switchData = parts[0].substring(3); // $R, 제거
          const switches = switchData.split(',');

          // 각 스위치 상태 파싱
          switches.forEach((state, index) => {
            switchStates[`SW${index + 1}`] = state === '1';
          });

          // 체크섬 정보도 저장
          if (parts.length >= 2) {
            switchStates.checksum = parts[1];
          }
        }
      } else {
        // 기타 형식의 데이터
        switchStates = {
          rawValue: rawData,
          timestamp: new Date().toISOString()
        };
      }

      // 데이터 저장
      latestData = {
        timestamp: new Date().toISOString(),
        rawData: rawData,
        switchStates: switchStates,
        status: 'connected',
        port: SERIAL_PORT
      };

      console.log('🔌 스위치 상태:', switchStates);
    });

  } catch (error) {
    console.error('❌ RS-232 포트 초기화 실패:', error.message);
  }
}

// 시뮬레이션 모드 (RS-232 장비가 없을 때)
function startSimulation() {
  console.log('🎭 시뮬레이션 모드 시작 (RS-232 장비 없음)');

  setInterval(() => {
    latestData = {
      timestamp: new Date().toISOString(),
      rawData: (Math.random() * 100).toFixed(2),
      value: Math.random() * 100,
      status: 'simulation',
      port: 'SIMULATION'
    };
    console.log('📡 시뮬레이션 데이터:', latestData);
  }, 2000); // 2초마다 새로운 데이터
}

// API 엔드포인트들
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    serialConnected: isConnected,
    port: SERIAL_PORT,
    baudRate: BAUD_RATE,
    lastData: latestData ? latestData.timestamp : null
  });
});

app.get('/api/serial-data', (req, res) => {
  if (latestData) {
    res.json(latestData);
  } else {
    res.json({
      timestamp: new Date().toISOString(),
      rawData: 'no_data',
      value: 0,
      status: 'no_data',
      port: SERIAL_PORT
    });
  }
});

app.get('/api/connect', (req, res) => {
  if (!isConnected) {
    initSerialPort();
    res.json({ message: 'RS-232 포트 연결 시도 중...' });
  } else {
    res.json({ message: '이미 연결됨' });
  }
});

app.get('/api/disconnect', (req, res) => {
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
    res.json({ message: 'RS-232 포트 연결 해제됨' });
  } else {
    res.json({ message: '연결되지 않음' });
  }
});

// 서버 시작
app.listen(port, () => {
  console.log(`🚀 RS-232 브리지 서버 시작됨: http://localhost:${port}`);
  console.log(`📡 API 엔드포인트:`);
  console.log(`   - GET /api/status - 서버 상태 확인`);
  console.log(`   - GET /api/serial-data - 최신 RS-232 데이터`);
  console.log(`   - GET /api/connect - RS-232 포트 연결`);
  console.log(`   - GET /api/disconnect - RS-232 포트 해제`);

  // RS-232 포트 초기화 시도
  initSerialPort();

  // RS-232 연결 실패 시 시뮬레이션 모드 시작 (비활성화)
  // setTimeout(() => {
  //   if (!isConnected) {
  //     console.log('⚠️ RS-232 포트 연결 실패, 시뮬레이션 모드로 전환');
  //     startSimulation();
  //   }
  // }, 3000);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 서버 종료 중...');
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  process.exit(0);
});
