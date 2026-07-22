// Fisheye "donut" dewarp renderer (panorama-pane split / virtual PTZ).
// Ported from the donut-dewarp-panes prototype's Three.js shaders.
//
// Params are split into two groups:
//  - "params" (setParams): the saved calibration (center/radius/rotation/lens/fov/mode/layout/aspect) -
//    these come from the camera Edit form and are persisted.
//  - "ephemeral" (setEphemeral): flip/ccw - these may start from a saved default but any change made
//    by a caller is expected to stay client-side only (never written back).
import * as THREE from 'three';

const LAYOUTS = {
  L1: [{x: 0, y: 0, w: 1, h: 1}],
  L2H: [{x: 0, y: 0, w: 0.5, h: 1}, {x: 0.5, y: 0, w: 0.5, h: 1}],
  L2V: [{x: 0, y: 0, w: 1, h: 0.5}, {x: 0, y: 0.5, w: 1, h: 0.5}],
  L4: [
    {x: 0, y: 0, w: 0.5, h: 0.5}, {x: 0.5, y: 0, w: 0.5, h: 0.5},
    {x: 0, y: 0.5, w: 0.5, h: 0.5}, {x: 0.5, y: 0.5, w: 0.5, h: 0.5},
  ],
  L13: [
    {x: 0, y: 0, w: 2 / 3, h: 1},
    {x: 2 / 3, y: 0, w: 1 / 3, h: 1 / 3},
    {x: 2 / 3, y: 1 / 3, w: 1 / 3, h: 1 / 3},
    {x: 2 / 3, y: 2 / 3, w: 1 / 3, h: 1 / 3},
  ],
};

const VERT = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.);}';
const COMMON = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tex;
  uniform vec2 texSize, centerPx;
  uniform float radiusPx, rotate, dir, lensK;
  vec4 checker(){
    float c = mod(floor(gl_FragCoord.x/8.)+floor(gl_FragCoord.y/8.),2.);
    return vec4(vec3(.05+.03*c),1.);
  }
  vec4 sampleFish(float rNorm, float phi){
    float r = rNorm*(1.+lensK*(rNorm*rNorm-1.));
    float a = dir*phi + rotate;
    vec2 px = centerPx + radiusPx*r*vec2(cos(a),-sin(a));
    vec2 uv = vec2(px.x/texSize.x, 1.-px.y/texSize.y);
    if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.) return checker();
    return texture2D(tex,uv);
  }
`;

/**
 * @param {HTMLCanvasElement} canvas the dewarped output canvas
 * @param {HTMLCanvasElement} [sourceCanvas] optional - shows the raw fisheye source with a
 *   circle overlay for the current calibration, and lets the caller pick the center by
 *   clicking on it (via onCenterPick). Mainly useful for the Edit form's calibration UI;
 *   the detail/viewing page has no reason to pass this.
 * @returns {object} controller
 */
export function createFisheyeDewarp(canvas, sourceCanvas) {
  const params = {
    cx: 50, cy: 50, rad: 98, rin: 0.25, rout: 1.0, rot: 0,
    lens: 0, ffov: 180, mode: 'seg', layout: 'L1', aspect: 6,
  };
  const ephemeral = {flip: false, ccw: false};

  let panes = [];
  let activePane = 0;
  let srcEl = null;
  let srcW = 1024;
  let srcH = 1024;
  let texture = null;
  let running = false;
  let rafId = null;
  let onPanesChange = null;
  let onCenterPick = null;
  const srcCtx = sourceCanvas ? sourceCanvas.getContext('2d') : null;

  const renderer = new THREE.WebGLRenderer({canvas, antialias: false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.autoClear = false;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uSeg = {
    tex: {value: null}, texSize: {value: new THREE.Vector2(1, 1)},
    centerPx: {value: new THREE.Vector2(512, 512)}, radiusPx: {value: 500},
    rotate: {value: 0}, dir: {value: 1}, lensK: {value: 0},
    rInner: {value: 0.25}, rOuter: {value: 1}, flipY: {value: 0},
    thetaStart: {value: 0}, thetaSpan: {value: Math.PI * 2},
  };
  const matSeg = new THREE.ShaderMaterial({
    uniforms: uSeg,
    vertexShader: VERT,
    fragmentShader: COMMON + `
      uniform float rInner,rOuter,flipY,thetaStart,thetaSpan;
      void main(){
        float phi = thetaStart + vUv.x*thetaSpan;
        float t = mix(vUv.y, 1.-vUv.y, flipY);
        float rNorm = mix(rInner, rOuter, t);
        gl_FragColor = sampleFish(rNorm, phi);
      }`,
  });

  const uPtz = {
    tex: {value: null}, texSize: {value: new THREE.Vector2(1, 1)},
    centerPx: {value: new THREE.Vector2(512, 512)}, radiusPx: {value: 500},
    rotate: {value: 0}, dir: {value: 1}, lensK: {value: 0},
    fishHalf: {value: Math.PI / 2},
    pan: {value: 0}, tilt: {value: 0}, tanHalf: {value: 0.7}, pAspect: {value: 1.78},
    rInnerP: {value: 0},
  };
  const matPtz = new THREE.ShaderMaterial({
    uniforms: uPtz,
    vertexShader: VERT,
    fragmentShader: COMMON + `
      uniform float fishHalf, pan, tilt, tanHalf, pAspect, rInnerP;
      void main(){
        vec2 ndc = vUv*2.-1.;
        vec3 d = normalize(vec3(ndc.x*tanHalf*pAspect, ndc.y*tanHalf, 1.));
        float ct=cos(tilt), st=sin(tilt);
        d = vec3(d.x, d.y*ct - d.z*st, d.y*st + d.z*ct);
        float cp=cos(pan), sp=sin(pan);
        d = vec3(d.x*cp - d.y*sp, d.x*sp + d.y*cp, d.z);
        float theta = acos(clamp(d.z,-1.,1.));
        if(theta > fishHalf*1.02){ gl_FragColor = checker(); return; }
        if(theta < fishHalf*rInnerP){ gl_FragColor = checker(); return; }
        float phi = atan(d.y, d.x);
        gl_FragColor = sampleFish(theta/fishHalf, phi);
      }`,
  });

  const geo = new THREE.PlaneGeometry(2, 2);
  const sceneSeg = new THREE.Scene();
  sceneSeg.add(new THREE.Mesh(geo, matSeg));
  const scenePtz = new THREE.Scene();
  scenePtz.add(new THREE.Mesh(geo, matPtz));

  function defaultPanes() {
    const n = LAYOUTS[params.layout].length;
    const list = [];
    for (let i = 0; i < n; i++) {
      list.push({
        segOff: 0,
        pan: (360 / n) * i,
        tilt: Math.min(45, params.ffov / 2 - 10),
        vfov: 70,
      });
    }
    return list;
  }

  function applyUniforms() {
    [uSeg, uPtz].forEach((u) => {
      u.texSize.value.set(srcW, srcH);
      u.centerPx.value.set(params.cx / 100 * srcW, params.cy / 100 * srcH);
      u.radiusPx.value = params.rad / 100 * Math.min(srcW, srcH) / 2;
      u.rotate.value = params.rot * Math.PI / 180;
      u.dir.value = ephemeral.ccw ? -1 : 1;
      u.lensK.value = params.lens;
    });
    uSeg.rInner.value = Math.min(params.rin, params.rout - 0.01);
    uSeg.rOuter.value = params.rout;
    uSeg.flipY.value = ephemeral.flip ? 1 : 0;
    uPtz.fishHalf.value = params.ffov / 2 * Math.PI / 180;
    uPtz.rInnerP.value = Math.min(params.rin, params.rout - 0.01);

    resize();
    drawSourceOverlay();
  }

  // Raw source preview + circle overlay (center/inner/outer radius, start angle) so
  // calibration values can be set by eye instead of guessing from sliders alone.
  function drawSourceOverlay() {
    if (!srcCtx || !srcEl) {
      return;
    }
    const maxW = sourceCanvas.parentElement ? sourceCanvas.parentElement.clientWidth : 400;
    const scale = Math.min(maxW / srcW, 340 / srcH, 1);
    sourceCanvas.width = Math.round(srcW * scale);
    sourceCanvas.height = Math.round(srcH * scale);
    srcCtx.drawImage(srcEl, 0, 0, sourceCanvas.width, sourceCanvas.height);

    const cx = params.cx / 100 * sourceCanvas.width;
    const cy = params.cy / 100 * sourceCanvas.height;
    const r = params.rad / 100 * Math.min(sourceCanvas.width, sourceCanvas.height) / 2;

    srcCtx.lineWidth = 1.5;
    srcCtx.strokeStyle = '#ffb454';
    srcCtx.beginPath();
    srcCtx.arc(cx, cy, r * params.rout, 0, Math.PI * 2);
    srcCtx.stroke();

    srcCtx.strokeStyle = '#4fd1c5';
    srcCtx.fillStyle = 'rgba(79,209,197,.12)';
    srcCtx.beginPath();
    srcCtx.arc(cx, cy, r * params.rin, 0, Math.PI * 2);
    srcCtx.fill();
    srcCtx.stroke();

    srcCtx.strokeStyle = '#ffffffaa';
    srcCtx.beginPath();
    srcCtx.moveTo(cx - 8, cy);
    srcCtx.lineTo(cx + 8, cy);
    srcCtx.moveTo(cx, cy - 8);
    srcCtx.lineTo(cx, cy + 8);
    srcCtx.stroke();

    const a = -params.rot * Math.PI / 180 * (ephemeral.ccw ? -1 : 1);
    srcCtx.strokeStyle = '#ff7847';
    srcCtx.setLineDash([5, 4]);
    srcCtx.beginPath();
    srcCtx.moveTo(cx + Math.cos(a) * r * params.rin, cy + Math.sin(a) * r * params.rin);
    srcCtx.lineTo(cx + Math.cos(a) * r * params.rout, cy + Math.sin(a) * r * params.rout);
    srcCtx.stroke();
    srcCtx.setLineDash([]);
  }

  function onSourceCanvasClick(e) {
    const r = sourceCanvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) / r.width * 100;
    const cy = (e.clientY - r.top) / r.height * 100;
    if (onCenterPick) {
      onCenterPick({cx, cy});
    }
  }

  if (sourceCanvas) {
    sourceCanvas.style.cursor = 'crosshair';
    sourceCanvas.addEventListener('click', onSourceCanvasClick);
  }

  function resize() {
    const w = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.clientWidth;
    if (!w) {
      return;
    }
    // Only guard against zero/negative height - a fixed floor here would distort the
    // configured aspect ratio at small container widths (e.g. a 6:1 layout at 240px
    // wide "should" be 40px tall; flooring it to 100px made it look like ~2.4:1 instead).
    const h = Math.max(1, Math.round(w / params.aspect));
    renderer.setSize(w, h, false);
    canvas.style.height = h + 'px';
    // setSize() just changed the canvas's width/height attributes, which per the HTML
    // canvas spec clears the drawing buffer - without an immediate repaint here, the
    // browser can paint that cleared (black) frame before the render loop's next rAF
    // tick gets to it, showing up as a brief black flash on every resize.
    renderFrame();
  }

  function renderFrame() {
    if (!texture) {
      return;
    }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    renderer.setScissorTest(true);

    const rects = LAYOUTS[params.layout];
    rects.forEach((r, i) => {
      const s = panes[i];
      if (!s) {
        return;
      }
      const vx = r.x * w;
      const vy = h - (r.y + r.h) * h;
      const vw = r.w * w;
      const vh = r.h * h;
      renderer.setViewport(vx, vy, vw, vh);
      renderer.setScissor(vx, vy, vw, vh);

      if (params.mode === 'ptz') {
        uPtz.pan.value = s.pan * Math.PI / 180;
        uPtz.tilt.value = s.tilt * Math.PI / 180;
        uPtz.tanHalf.value = Math.tan(s.vfov / 2 * Math.PI / 180);
        uPtz.pAspect.value = vw / vh;
        renderer.render(scenePtz, camera);
      } else {
        const span = Math.PI * 2 / rects.length;
        uSeg.thetaStart.value = span * i + s.segOff * Math.PI / 180;
        uSeg.thetaSpan.value = span;
        renderer.render(sceneSeg, camera);
      }
    });
    renderer.setScissorTest(false);
  }

  // Pane interaction: drag = pan/tilt (ptz) or angle offset (seg), wheel = zoom (ptz only).
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function paneAt(e) {
    const r = canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const rects = LAYOUTS[params.layout];
    for (let i = 0; i < rects.length; i++) {
      const q = rects[i];
      if (fx >= q.x && fx < q.x + q.w && fy >= q.y && fy < q.y + q.h) {
        return i;
      }
    }
    return -1;
  }

  function onPointerDown(e) {
    const i = paneAt(e);
    if (i < 0) {
      return;
    }
    activePane = i;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) {
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const rect = LAYOUTS[params.layout][activePane];
    const paneW = rect.w * canvas.clientWidth;
    const paneH = rect.h * canvas.clientHeight;
    const s = panes[activePane];
    if (!s) {
      return;
    }
    if (params.mode === 'ptz') {
      s.pan -= dx / paneW * s.vfov * (ephemeral.ccw ? -1 : 1);
      s.tilt -= dy / paneH * s.vfov;
      s.tilt = Math.max(0, Math.min(params.ffov / 2, s.tilt));
    } else {
      s.segOff -= dx / paneW * (360 / panes.length);
    }
    if (onPanesChange) {
      onPanesChange(panes);
    }
  }

  function onPointerUp() {
    dragging = false;
  }

  function onWheel(e) {
    if (params.mode !== 'ptz') {
      return;
    }
    const i = paneAt(e);
    if (i < 0) {
      return;
    }
    e.preventDefault();
    activePane = i;
    const s = panes[i];
    s.vfov = Math.max(15, Math.min(110, s.vfov * (e.deltaY > 0 ? 1.08 : 0.92)));
    if (onPanesChange) {
      onPanesChange(panes);
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, {passive: false});
  window.addEventListener('resize', resize);

  let lastVideoTime = -1;
  let frame = 0;
  function loop() {
    if (!running) {
      return;
    }
    rafId = requestAnimationFrame(loop);
    
    let shouldRender = dragging || !srcEl;
    if (srcEl && srcEl.currentTime !== undefined) {
      if (srcEl.currentTime !== lastVideoTime) {
        lastVideoTime = srcEl.currentTime;
        shouldRender = true;
      }
    } else if (srcEl) {
      shouldRender = true;
    }

    if (shouldRender) {
      renderFrame();
    }
    
    // Source is a live video - keep the overlay preview's frame current too (throttled,
    // it's just a calibration aid, doesn't need to match the render loop's framerate).
    if (srcCtx && frame++ % 3 === 0) {
      drawSourceOverlay();
    }
  }

  return {
    /**
     * @param {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement} el
     * @param {number} w
     * @param {number} h
     * @param {boolean} isVideo
     */
    setSource(el, w, h, isVideo) {
      if (texture) {
        texture.dispose();
      }
      srcEl = el;
      srcW = w;
      srcH = h;
      texture = isVideo ? new THREE.VideoTexture(el) : new THREE.Texture(el);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      if (!isVideo) {
        texture.needsUpdate = true;
      }
      uSeg.tex.value = texture;
      uPtz.tex.value = texture;
      applyUniforms();
    },
    /** Saved calibration - from the camera Edit form. */
    setParams(newParams) {
      Object.assign(params, newParams);
      if (!panes.length || panes.length !== LAYOUTS[params.layout].length) {
        panes = (newParams.panes && newParams.panes.length === LAYOUTS[params.layout].length) ?
          newParams.panes : defaultPanes();
      }
      applyUniforms();
    },
    /** Client-side-only overrides (flip/direction) - never persisted by this module. */
    setEphemeral(newEphemeral) {
      Object.assign(ephemeral, newEphemeral);
      applyUniforms();
    },
    setPanes(newPanes) {
      panes = newPanes;
    },
    getPanes() {
      return panes;
    },
    onPanesChange(cb) {
      onPanesChange = cb;
    },
    /** Fired with {cx, cy} (percentages) when the source preview canvas is clicked. */
    onCenterPick(cb) {
      onCenterPick = cb;
    },
    resize,
    startLoop() {
      if (running) {
        return;
      }
      running = true;
      loop();
    },
    stopLoop() {
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    },
    destroy() {
      this.stopLoop();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      if (sourceCanvas) {
        sourceCanvas.removeEventListener('click', onSourceCanvasClick);
      }
      if (texture) {
        texture.dispose();
      }
      renderer.dispose();
    },
  };
}
