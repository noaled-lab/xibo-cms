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
 * @param {HTMLCanvasElement} canvas
 * @returns {object} controller
 */
export function createFisheyeDewarp(canvas) {
  const params = {
    cx: 50, cy: 50, rad: 98, rin: 0.25, rout: 1.0, rot: 0,
    lens: 0, ffov: 180, mode: 'seg', layout: 'L1', aspect: 6,
  };
  const ephemeral = {flip: false, ccw: false};

  let panes = [];
  let activePane = 0;
  let srcW = 1024;
  let srcH = 1024;
  let texture = null;
  let running = false;
  let rafId = null;
  let onPanesChange = null;

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
  }

  function resize() {
    const w = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.clientWidth;
    if (!w) {
      return;
    }
    const h = Math.max(100, Math.round(w / params.aspect));
    renderer.setSize(w, h, false);
    canvas.style.height = h + 'px';
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

  function loop() {
    if (!running) {
      return;
    }
    rafId = requestAnimationFrame(loop);
    renderFrame();
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
      if (texture) {
        texture.dispose();
      }
      renderer.dispose();
    },
  };
}
