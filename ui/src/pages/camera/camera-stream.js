// Shared MSE/WebSocket live-stream player, used by both the camera grid page
// and the camera detail page (extracted from the original inline camera-page.js).

function utf8ArrayToStr(array) {
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

/**
 * Start playing an rtsp-to-web MSE/WebSocket stream into a <video> element.
 * @param {HTMLVideoElement} videoEl
 * @param {string} url websocket URL
 * @return {{stop: function}}
 */
export function startPlay(videoEl, url) {
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
    if (!mseSourceBuffer) {
      return;
    }
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
          mimeCodec = utf8ArrayToStr(decodedArr);
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
      try {
        if (ws) {
          ws.close();
        }
      } catch (e) { /* noop */ }
      try {
        videoEl.removeAttribute('src');
        videoEl.load();
      } catch (e) { /* noop */ }
      try {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (e) { /* noop */ }
    },
  };
}
