import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// --- Sequence mapping helpers (ported verbatim from quaternion_julia.html) ---
const KD = {I:4.5,V:4.2,L:3.8,F:2.8,C:2.5,M:1.9,A:1.8,G:-0.4,T:-0.7,S:-0.8,W:-0.9,Y:-1.3,P:-1.6,H:-3.2,E:-3.5,Q:-3.5,D:-3.5,N:-3.5,K:-3.9,R:-4.5};
const clean = s => (s || '').toUpperCase().replace(/[^A-Z]/g, '');
const isDNA = s => /^[ACGTN]+$/.test(s);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const remap01 = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
function entropyKmer(s, alphabet, k){
  const n = s.length;
  if (n < k) return 0;
  const map = new Map();
  for (let i = 0; i <= n - k; i++){
    const sub = s.slice(i, i + k);
    let valid = true;
    for (const ch of sub){ if (!alphabet.has(ch)) { valid = false; break; } }
    if (!valid) continue;
    map.set(sub, (map.get(sub) || 0) + 1);
  }
  let H = 0, total = 0;
  for (const c of map.values()) total += c;
  for (const c of map.values()){
    const p = c / total;
    H -= p * Math.log2(p);
  }
  return H;
}
function gcContent(s){
  const g = (s.match(/G/g) || []).length;
  const c = (s.match(/C/g) || []).length;
  const a = (s.match(/A/g) || []).length;
  const t = (s.match(/T/g) || []).length;
  const denom = g + c + a + t;
  return denom ? (g + c) / denom : 0;
}
function cpgOE(s){
  const L = s.length;
  if (L < 2) return 0;
  const c = (s.match(/C/g) || []).length;
  const g = (s.match(/G/g) || []).length;
  const cg = (s.match(/CG/g) || []).length;
  return (cg * L) / Math.max(1, c * g);
}
function proteinStats(s){
  const L = s.length;
  if (!L) return { hyd: 0, arom: 0, charge: 0 };
  let hyd = 0, arom = 0, pos = 0, neg = 0, his = 0;
  for (const ch of s){
    hyd += (KD[ch] ?? 0);
    if (ch === 'F' || ch === 'Y' || ch === 'W') arom++;
    if (ch === 'K' || ch === 'R') pos++;
    if (ch === 'D' || ch === 'E') neg++;
    if (ch === 'H') his++;
  }
  return { hyd: hyd / L, arom: arom / L, charge: (pos + 0.1 * his - neg) / L };
}
function seqToParams(raw, defaults){
  const s = clean(raw);
  if (!s.length) return null;
  const L = s.length;
  const lenNorm = remap01(Math.log10(L), Math.log10(30), Math.log10(30000));
  let cx = 0, cy = 0, cz = 0, cw = 0;
  let iters = defaults.iterations ?? 24;
  let fold = defaults.fold ?? 0.8;
  let rough = defaults.roughness ?? 0.26;

  if (isDNA(s)){
    const gc = gcContent(s);
    const H3 = entropyKmer(s, new Set(['A','C','G','T','N']), 3);
    const H3n = clamp(H3 / 6, 0, 1);
    const oe = clamp(cpgOE(s), 0, 2.0);
    cx = -0.8 + 1.6 * gc;
    cy = -0.8 + 1.6 * H3n;
    cz = -0.8 + 1.6 * (oe / 2.0);
    cw = -0.8 + 1.6 * lenNorm;
    iters = 10 + Math.floor(18 * H3n);
    fold = 0.65 + 0.35 * clamp(oe / 1.5, 0, 1);
    rough = 0.22 + 0.36 * (1.0 - H3n);
  } else {
    const { hyd, arom, charge } = proteinStats(s);
    const hydN = remap01(hyd, -4.5, 4.5);
    const chN = remap01((charge + 1) * 0.5, 0, 1);
    cx = -0.8 + 1.6 * hydN;
    cy = -0.8 + 1.6 * clamp(arom / 0.2, 0, 1);
    cz = -0.8 + 1.6 * chN;
    cw = -0.8 + 1.6 * lenNorm;
    const H2 = entropyKmer(s, new Set('ACDEFGHIKLMNPQRSTVWY'.split('')), 2);
    const H2n = clamp(H2 / 8.64, 0, 1);
    iters = 10 + Math.floor(18 * H2n);
    fold = 0.6 + 0.4 * clamp(arom / 0.15, 0, 1);
    rough = 0.18 + 0.42 * (1.0 - hydN);
  }

  const r = Math.hypot(cx, cy, cz, cw);
  if (r > 0.95){
    const scale = 0.95 / r;
    cx *= scale;
    cy *= scale;
    cz *= scale;
    cw *= scale;
  }

  return {
    c: new THREE.Vector4(cx, cy, cz, cw),
    iters,
    fold,
    rough
  };
}

const C_LOOP_FREQS = [0.77, 1.13, 0.91, 1.27];
const C_LOOP_PHASES = [0.0, 1.1, 2.2, 0.7];
const C_LOOP_RADII  = [0.65, 0.35, 0.28, 0.42];
const TAU = Math.PI * 2;

const PLANE_N0 = new THREE.Vector3(1, 0, 0);
const PLANE_N1 = new THREE.Vector3(-0.8090169943749473, -0.5, 0.30901699437494745);
const PLANE_N2 = new THREE.Vector3(0, 1, 0);
const SAMPLE_OFFSETS = [
  [0, 0],
  [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45],
  [0.32, 0.32], [-0.32, 0.32], [0.32, -0.32], [-0.32, -0.32]
];
const TMP_LOCAL = new THREE.Vector3();
const TMP_FOLD = new THREE.Vector3();
const TMP_POS = new THREE.Vector3();
const TMP_HIT = new THREE.Vector3();
const TMP_DIR = new THREE.Vector3();
const TMP_UP = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_RO = new THREE.Vector3();
const TMP_RAY = new THREE.Vector3();
const TMP_AVG = new THREE.Vector3();
const JS_MAX_STEPS = 160;
const JS_MAX_DIST = 20;
const JS_SURF_EPS = 0.00075;

export async function createVisualizer(canvas, opts = {}){
  if (!(canvas instanceof HTMLCanvasElement)){
    throw new Error('createVisualizer requires an HTMLCanvasElement.');
  }

  const mq = window.matchMedia('(prefers-reduced-motion)');
  const defaults = {
    sequence: null,
    animateSlice: false,
    sliceAmplitude: 0.18,
    sliceSpeed: 0.035,
    animateRotation: false,
    rotationSpeed: 0.022,
    animateCLoop: false,
    cLoopSpeed: 0.02,
    cLoopScale: 0.9,
    bloom: 0.55,
    exposure: 1.15,
    roughness: 0.26,
    fold: 0.8,
    iterations: 24,
    bailout: 8.0,
    slice: 0.1,
    cameraDistance: 4.0,
    cameraAzimuth: -28,
    cameraElevation: 18,
    reducedMotion: mq.matches,
    enablePost: true
  };
  const settings = { ...defaults, ...opts };
  let hasReducedOverride = Object.prototype.hasOwnProperty.call(opts, 'reducedMotion');
  const cleanup = [];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.autoClear = false;

  const BASE_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 2);
  const MIN_PIXEL_RATIO = Math.min(BASE_PIXEL_RATIO, 1);
  const STATIC_SCALE = 0.9;
  const ANIM_SCALE = 0.75;

  renderer.setPixelRatio(BASE_PIXEL_RATIO);
  renderer.setSize(window.innerWidth * STATIC_SCALE, window.innerHeight * STATIC_SCALE, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const drawingBufferSize = new THREE.Vector2();
  renderer.getDrawingBufferSize(drawingBufferSize);

  const scene = new THREE.Scene();
  const screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const viewCam = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 100);
  function updateCameraFromSettings(){
    const az = THREE.MathUtils.degToRad(settings.cameraAzimuth ?? 0);
    const el = THREE.MathUtils.degToRad(settings.cameraElevation ?? 0);
    const radius = settings.cameraDistance;
    const cosEl = Math.cos(el);
    viewCam.position.set(
      radius * cosEl * Math.sin(az),
      radius * Math.sin(el),
      radius * cosEl * Math.cos(az)
    );
    viewCam.lookAt(0, 0, 0);
  }
  updateCameraFromSettings();

  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: drawingBufferSize.clone() },
    uCamPos: { value: new THREE.Vector3() },
    uCamDir: { value: new THREE.Vector3() },
    uCamRight: { value: new THREE.Vector3() },
    uCamUp: { value: new THREE.Vector3() },
    uTanFovX: { value: Math.tan(THREE.MathUtils.degToRad(viewCam.fov * 0.5)) * viewCam.aspect },
    uTanFovY: { value: Math.tan(THREE.MathUtils.degToRad(viewCam.fov * 0.5)) },

    uC: { value: new THREE.Vector4(0.2, 0.0, 0.0, 0.0) },
    uSlice: { value: settings.slice },
    uIters: { value: settings.iterations | 0 },
    uBailout: { value: settings.bailout },
    uFoldStrength: { value: settings.fold },
    uFoldIters: { value: 18 },
    uOffset: { value: new THREE.Vector3(0, 0, 0) },

    uGoldColor: { value: new THREE.Vector3(0.95, 0.78, 0.22) },
    uRoughness: { value: settings.roughness },
    uExposure: { value: settings.exposure },

    uThetaZW:   { value: 0.0 },
    uSliceBase: { value: settings.slice },
    uSliceAmp:  { value: settings.animateSlice ? settings.sliceAmplitude : 0.0 },
    uSlicePhase:{ value: 0.0 },
    uAnimFlags: { value: 0 },
    uCAnimScale:{ value: settings.cLoopScale },

    uReduced: { value: settings.reducedMotion ? 1 : 0 },
  };

  function foldH3_JS(vec){
    const iterations = uniforms.uFoldIters.value | 0;
    for (let i = 0; i < iterations; i++){
      const d0 = vec.dot(PLANE_N0); if (d0 < 0) vec.addScaledVector(PLANE_N0, -2 * d0);
      const d1 = vec.dot(PLANE_N1); if (d1 < 0) vec.addScaledVector(PLANE_N1, -2 * d1);
      const d2 = vec.dot(PLANE_N2); if (d2 < 0) vec.addScaledVector(PLANE_N2, -2 * d2);
      if (d0 >= 0 && d1 >= 0 && d2 >= 0) break;
    }
    return vec;
  }

  function juliaDE_JS(p){
    TMP_LOCAL.copy(p);
    TMP_FOLD.copy(TMP_LOCAL);
    foldH3_JS(TMP_FOLD);
    const foldStrength = THREE.MathUtils.clamp(uniforms.uFoldStrength.value, 0, 1);
    if (foldStrength > 0) TMP_LOCAL.lerp(TMP_FOLD, foldStrength);
    TMP_LOCAL.sub(uniforms.uOffset.value);

    let zx = TMP_LOCAL.x;
    let zy = TMP_LOCAL.y;
    let zz = TMP_LOCAL.z;
    const animFlags = uniforms.uAnimFlags.value | 0;
    const sliceBase = uniforms.uSliceBase.value;
    const sliceAmp = uniforms.uSliceAmp.value;
    const slicePhase = uniforms.uSlicePhase.value;
    let zw = (animFlags & 1) !== 0 ? (sliceBase + sliceAmp * Math.sin(slicePhase)) : uniforms.uSlice.value;
    let mdr = 1;
    let r = Math.hypot(zx, zy, zz, zw);
    const iters = Math.min(64, uniforms.uIters.value | 0);
    const bailout = uniforms.uBailout.value;
    const rotateZW = (animFlags & 2) !== 0;
    const cosTheta = Math.cos(uniforms.uThetaZW.value);
    const sinTheta = Math.sin(uniforms.uThetaZW.value);

    for (let i = 0; i < iters; i++){
      if (rotateZW){
        const zZ = zz;
        const zW = zw;
        zz = cosTheta * zZ - sinTheta * zW;
        zw = sinTheta * zZ + cosTheta * zW;
      }
      mdr = 2 * Math.max(r, 1e-6) * mdr;
      const x = zx; const y = zy; const z = zz; const w = zw;
      zx = 2 * w * x + uniforms.uC.value.x;
      zy = 2 * w * y + uniforms.uC.value.y;
      zz = 2 * w * z + uniforms.uC.value.z;
      zw = w * w - (x * x + y * y + z * z) + uniforms.uC.value.w;
      r = Math.hypot(zx, zy, zz, zw);
      if (r > bailout) break;
    }

    return 0.5 * Math.log(r) * r / Math.max(mdr, 1e-6);
  }

  function marchRayJS(ro, rd, outVec){
    let t = 0;
    for (let i = 0; i < JS_MAX_STEPS; i++){
      TMP_POS.copy(ro).addScaledVector(rd, t);
      const d = Math.abs(juliaDE_JS(TMP_POS));
      if (d < JS_SURF_EPS){
        if (outVec) outVec.copy(TMP_POS);
        return true;
      }
      t += Math.min(d, 0.5);
      if (t > JS_MAX_DIST) break;
    }
    return false;
  }

  function computeCameraCentroid(){
    viewCam.updateMatrixWorld(true);
    viewCam.getWorldDirection(TMP_DIR);
    TMP_UP.set(0, 1, 0).applyQuaternion(viewCam.quaternion).normalize();
    TMP_RIGHT.crossVectors(TMP_DIR, TMP_UP).normalize();
    TMP_RO.copy(viewCam.position);

    const tanY = Math.tan(THREE.MathUtils.degToRad(viewCam.fov * 0.5));
    const tanX = tanY * viewCam.aspect;

    TMP_AVG.set(0, 0, 0);
    let count = 0;
    for (const [ox, oy] of SAMPLE_OFFSETS){
      TMP_RAY.copy(TMP_DIR)
        .addScaledVector(TMP_RIGHT, ox * tanX)
        .addScaledVector(TMP_UP, oy * tanY)
        .normalize();
      if (marchRayJS(TMP_RO, TMP_RAY, TMP_HIT)){
        TMP_AVG.add(TMP_HIT);
        count++;
      }
    }
    if (!count) {
      console.warn('[visualizer] centroid hit test failed; keeping previous offset');
      return null;
    }
    return TMP_AVG.multiplyScalar(1 / count).clone();
  }

  function recenterFractal(){
    uniforms.uOffset.value.set(0, 0, 0);
    const centroid = computeCameraCentroid();
    if (!centroid) return null;
    uniforms.uOffset.value.copy(centroid);
    return centroid;
  }


  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float; precision highp int;
      varying vec2 vUv;

      uniform vec2  uResolution;
      uniform float uTime;
      uniform vec3  uCamPos, uCamDir, uCamRight, uCamUp;
      uniform float uTanFovX, uTanFovY;
      uniform vec4  uC;
      uniform float uSlice;
      uniform float uSliceBase;
      uniform float uSliceAmp;
      uniform float uSlicePhase;
      uniform float uThetaZW;
      uniform int   uAnimFlags;
      uniform int   uIters;
      uniform float uBailout;
      uniform float uFoldStrength;
      uniform int   uFoldIters;
      uniform vec3  uGoldColor;
      uniform float uRoughness;
      uniform float uExposure;
      uniform int   uReduced;
      uniform vec3  uOffset;

      #define PI 3.14159265358979323846
      #define MAX_STEPS 160
      #define MAX_DIST  20.0
      #define SURF_EPS  0.00075

      const vec3 n0 = vec3(1.0, 0.0, 0.0);
      const vec3 n1 = vec3(-0.8090169943749473, -0.5, 0.30901699437494745);
      const vec3 n2 = vec3(0.0, 1.0, 0.0);

      vec3 foldH3(vec3 p){
        for (int i = 0; i < 20; ++i){
          float d0 = dot(p, n0); if (d0 < 0.0) p -= 2.0 * d0 * n0;
          float d1 = dot(p, n1); if (d1 < 0.0) p -= 2.0 * d1 * n1;
          float d2 = dot(p, n2); if (d2 < 0.0) p -= 2.0 * d2 * n2;
          if (d0 >= 0.0 && d1 >= 0.0 && d2 >= 0.0) break;
        }
        return p;
      }

      vec4 qSquare(vec4 z){
        vec3 v = z.xyz;
        float w = z.w;
        return vec4(2.0 * w * v, w*w - dot(v, v));
      }

      float juliaDE(vec3 p){
        vec3 pf = mix(p, foldH3(p), clamp(uFoldStrength, 0.0, 1.0));
        pf -= uOffset;

        float wSlice = ((uAnimFlags & 1) != 0) ? (uSliceBase + uSliceAmp * sin(uSlicePhase)) : uSlice;
        vec4 z = vec4(pf, wSlice);

        float mdr = 1.0;
        float r = length(z);

        bool rotateZW = (uAnimFlags & 2) != 0;
        float cosTheta = cos(uThetaZW);
        float sinTheta = sin(uThetaZW);

        for (int i = 0; i < 64; ++i){
          if (i >= uIters) break;

          if (rotateZW){
            float zZ = z.z;
            float zW = z.w;
            z.z = cosTheta * zZ - sinTheta * zW;
            z.w = sinTheta * zZ + cosTheta * zW;
          }

          mdr = 2.0 * max(r, 1e-6) * mdr;
          z = qSquare(z) + uC;
          r = length(z);
          if (r > uBailout) break;
        }

        float de = 0.5 * log(r) * r / max(mdr, 1e-6);
        return abs(de);
      }

      vec3 calcNormal(vec3 p){
        const float e = 0.0018;
        const vec3 k1 = vec3(1.0,-1.0,-1.0);
        const vec3 k2 = vec3(-1.0,-1.0, 1.0);
        const vec3 k3 = vec3(-1.0, 1.0,-1.0);
        const vec3 k4 = vec3(1.0, 1.0, 1.0);
        return normalize(
          k1 * juliaDE(p + e * k1) +
          k2 * juliaDE(p + e * k2) +
          k3 * juliaDE(p + e * k3) +
          k4 * juliaDE(p + e * k4)
        );
      }

      vec3 fresnelSchlick(float cosTheta, vec3 F0){
        return F0 + (vec3(1.0) - F0) * pow(1.0 - cosTheta, 5.0);
      }
      float D_GGX(float NoH, float a){
        float a2 = a * a;
        float d = (NoH * NoH) * (a2 - 1.0) + 1.0;
        return a2 / (PI * d * d + 1e-6);
      }
      float V_SmithGGX(float NoV, float NoL, float a){
        float k = (a + 1.0);
        k = (k * k) / 8.0;
        float gv = NoV / (NoV * (1.0 - k) + k);
        float gl = NoL / (NoL * (1.0 - k) + k);
        return gv * gl;
      }

      bool raymarch(vec3 ro, vec3 rd, out vec3 p, out int steps){
        float t = 0.0; steps = 0;
        for (int i = 0; i < MAX_STEPS; ++i){
          vec3 pos = ro + rd * t;
          float d = juliaDE(pos);
          if (d < SURF_EPS){ p = pos; steps = i; return true; }
          t += d;
          if (t > MAX_DIST) break;
        }
        p = ro + rd * t; steps = MAX_STEPS; return false;
      }

      void main(){
        vec2 uv = vUv * 2.0 - 1.0;
        vec3 ro = uCamPos;
        vec3 rd = normalize(uCamDir + uv.x * uCamRight * uTanFovX + uv.y * uCamUp * uTanFovY);

        vec3 p; int steps; bool hit = raymarch(ro, rd, p, steps);
        vec3 col = vec3(0.0);

        if (hit){
          vec3 n = calcNormal(p);
          vec3 v = normalize(-rd);
          vec3 l1 = normalize(vec3(0.6, 0.5, 0.64));
          vec3 l2 = normalize(vec3(-0.4, -0.2, -0.3));
          float rough = clamp(uRoughness, 0.02, 0.95);
          float a = rough * rough;

          float NoV = max(dot(n, v), 0.0);
          float NoL1 = max(dot(n, l1), 0.0);
          float NoL2 = max(dot(n, l2), 0.0);

          vec3 h1 = normalize(v + l1);
          vec3 h2 = normalize(v + l2);
          float NoH1 = max(dot(n, h1), 0.0);
          float NoH2 = max(dot(n, h2), 0.0);
          float VoH1 = max(dot(v, h1), 0.0);
          float VoH2 = max(dot(v, h2), 0.0);

          vec3 F0 = uGoldColor;
          vec3 spec1 = (D_GGX(NoH1, a) * V_SmithGGX(NoV, NoL1, a)) * fresnelSchlick(VoH1, F0) * NoL1;
          vec3 spec2 = (D_GGX(NoH2, a) * V_SmithGGX(NoV, NoL2, a)) * fresnelSchlick(VoH2, F0) * NoL2;
          float ambient = 0.06 + 0.12 * smoothstep(0.0, 1.0, float(steps) / float(MAX_STEPS));

          vec3 surf = ambient * (uGoldColor * 0.15) + spec1 + spec2;
          float vign = 0.9 - 0.25 * dot(uv, uv);
          surf *= max(vign, 0.65) * uExposure;
          col = surf;
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthWrite: false,
    depthTest: false
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);

  const usePost = settings.enablePost !== false;
  let composer = null;
  let bloomPass = null;
  let fxaaPass = null;
  if (usePost){
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, screenCam));
    if (settings.bloom > 0){
      bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), settings.bloom, 0.7, 0.8);
      composer.addPass(bloomPass);
    }
    fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.material.uniforms['resolution'].value.set(1 / drawingBufferSize.x, 1 / drawingBufferSize.y);
    fxaaPass.renderToScreen = true;
    composer.addPass(fxaaPass);
  }

  function updateBloomPipeline(){
    if (!usePost) return;
    if (settings.bloom > 0){
      if (!bloomPass){
        bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), settings.bloom, 0.7, 0.8);
        const fxaaIndex = composer.passes.indexOf(fxaaPass);
        composer.insertPass(bloomPass, Math.max(0, fxaaIndex));
      }
      bloomPass.strength = settings.bloom;
    } else if (bloomPass){
      composer.removePass(bloomPass);
      bloomPass = null;
    }
    if (composer) setRendererSize();
  }

  // Sync helper functions
  const baseC = uniforms.uC.value.clone();
  function applySequence(seq){
    const mapped = seqToParams(seq, settings);
    if (!mapped) return false;
    uniforms.uC.value.copy(mapped.c);
    baseC.copy(mapped.c);
    uniforms.uIters.value = mapped.iters | 0;
    uniforms.uFoldStrength.value = mapped.fold;
    uniforms.uRoughness.value = mapped.rough;
    settings.iterations = mapped.iters | 0;
    settings.fold = mapped.fold;
    settings.roughness = mapped.rough;
    return true;
  }
  if (settings.sequence) applySequence(settings.sequence);

  function updateCameraUniforms(){
    viewCam.updateMatrixWorld(true);
    const dir = new THREE.Vector3(); viewCam.getWorldDirection(dir);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(viewCam.quaternion).normalize();
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    uniforms.uCamPos.value.copy(viewCam.position);
    uniforms.uCamDir.value.copy(dir);
    uniforms.uCamUp.value.copy(up);
    uniforms.uCamRight.value.copy(right);
    uniforms.uTanFovY.value = Math.tan(THREE.MathUtils.degToRad(viewCam.fov * 0.5));
    uniforms.uTanFovX.value = uniforms.uTanFovY.value * viewCam.aspect;
  }

  function syncAnimUniforms(){
    uniforms.uSlice.value = settings.slice;
    uniforms.uSliceBase.value = settings.slice;
    uniforms.uSliceAmp.value = settings.animateSlice ? settings.sliceAmplitude : 0.0;
    uniforms.uCAnimScale.value = settings.cLoopScale;
    uniforms.uIters.value = settings.iterations | 0;
    uniforms.uFoldStrength.value = settings.fold;
    uniforms.uRoughness.value = settings.roughness;
    uniforms.uExposure.value = settings.exposure;
    uniforms.uBailout.value = settings.bailout;
    uniforms.uAnimFlags.value = (settings.animateSlice ? 1 : 0) |
      (settings.animateRotation ? 2 : 0) |
      (settings.animateCLoop ? 4 : 0);
    setRendererSize();
  }
  syncAnimUniforms();
  recenterFractal();

  const updateReducedUniform = () => {
    uniforms.uReduced.value = hasReducedOverride
      ? (settings.reducedMotion ? 1 : 0)
      : (mq.matches ? 1 : 0);
  };
  updateReducedUniform();
  if (!hasReducedOverride) {
    if ('addEventListener' in mq) {
      mq.addEventListener('change', updateReducedUniform);
      cleanup.push(() => mq.removeEventListener('change', updateReducedUniform));
    } else if ('addListener' in mq) {
      mq.addListener(updateReducedUniform);
      cleanup.push(() => mq.removeListener(updateReducedUniform));
    }
  }

  let elapsed = 0;
  let framePending = false;
  let last = performance.now();

  function updateAnimation(timeSeconds){
    const reduced = uniforms.uReduced.value === 1;
    const flags = reduced ? 0 : uniforms.uAnimFlags.value;

    if (!reduced && (flags & 1) && uniforms.uSliceAmp.value > 0.0){
      uniforms.uSlicePhase.value = settings.sliceSpeed * timeSeconds * TAU;
    } else {
      uniforms.uSlicePhase.value = 0.0;
    }

    if (!reduced && (flags & 2)){
      uniforms.uThetaZW.value = settings.rotationSpeed * timeSeconds * TAU;
    } else {
      uniforms.uThetaZW.value = 0.0;
    }

    if (!reduced && (flags & 4)){
      const speed = settings.cLoopSpeed * TAU;
      const limit = Math.min(settings.cLoopScale, 0.95);
      if (limit <= 0.0){
        uniforms.uC.value.copy(baseC);
      } else {
        const arg0 = C_LOOP_FREQS[0] * speed * timeSeconds + C_LOOP_PHASES[0];
        const arg1 = C_LOOP_FREQS[1] * speed * timeSeconds + C_LOOP_PHASES[1];
        const arg2 = C_LOOP_FREQS[2] * speed * timeSeconds + C_LOOP_PHASES[2];
        const arg3 = C_LOOP_FREQS[3] * speed * timeSeconds + C_LOOP_PHASES[3];
        let cx = baseC.x + C_LOOP_RADII[0] * Math.sin(arg0);
        let cy = baseC.y + C_LOOP_RADII[1] * Math.sin(arg1);
        let cz = baseC.z + C_LOOP_RADII[2] * Math.sin(arg2);
        let cw = baseC.w + C_LOOP_RADII[3] * Math.sin(arg3);
        const norm = Math.hypot(cx, cy, cz, cw);
        if (norm > limit && norm > 1e-6){
          const scale = limit / norm;
          cx *= scale; cy *= scale; cz *= scale; cw *= scale;
        }
        uniforms.uC.value.set(cx, cy, cz, cw);
      }
    } else {
      uniforms.uC.value.copy(baseC);
    }
  }

  function hasActiveAnimation(){
    return uniforms.uReduced.value === 0 && (
      settings.animateSlice || settings.animateRotation || settings.animateCLoop
    );
  }

  function setRendererSize(){
    const scale = hasActiveAnimation() ? ANIM_SCALE : STATIC_SCALE;
    const width = Math.max(1, window.innerWidth * scale);
    const height = Math.max(1, window.innerHeight * scale);
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.setPixelRatio(hasActiveAnimation() ? MIN_PIXEL_RATIO : BASE_PIXEL_RATIO);
    renderer.getDrawingBufferSize(drawingBufferSize);
    uniforms.uResolution.value.copy(drawingBufferSize);
    if (fxaaPass) fxaaPass.material.uniforms['resolution'].value.set(1 / drawingBufferSize.x, 1 / drawingBufferSize.y);
    if (bloomPass) bloomPass.setSize(width, height);
    if (composer) composer.setSize(width, height);
  }

  function renderFrame(){
    const now = performance.now();
    elapsed += (now - last) / 1000;
    last = now;
    uniforms.uTime.value = elapsed;

    renderer.getDrawingBufferSize(drawingBufferSize);
    uniforms.uResolution.value.copy(drawingBufferSize);

    if (bloomPass) bloomPass.strength = settings.bloom;
    updateCameraUniforms();
    updateAnimation(elapsed);
    if (usePost && composer) {
      composer.render();
    } else {
      renderer.clear();
      renderer.render(scene, screenCam);
    }
    framePending = false;
    if (hasActiveAnimation()) {
      requestRender();
    }
  }
  updateCameraUniforms();

  function requestRender(){
    if (!framePending) {
      framePending = true;
      requestAnimationFrame(renderFrame);
    }
  }
  requestRender();

  function resize(){
    const w = window.innerWidth;
    const h = window.innerHeight;
    setRendererSize();
    const db = new THREE.Vector2();
    renderer.getDrawingBufferSize(db);
    uniforms.uResolution.value.copy(db);
    viewCam.aspect = w / h;
    viewCam.updateProjectionMatrix();
    if (bloomPass) bloomPass.setSize(w, h);
    if (fxaaPass) fxaaPass.material.uniforms['resolution'].value.set(1 / db.x, 1 / db.y);
    if (composer) composer.setSize(w, h);
    requestRender();
  }

  function pause(){
    uniforms.uReduced.value = 1;
  }

  function resume(){
    updateReducedUniform();
    last = performance.now();
    requestRender();
  }

  function setSequence(seq){
    if (!applySequence(seq)) return false;
    settings.sequence = seq;
    recenterFractal();
    requestRender();
    return true;
  }

  function setParams(params = {}){
    const { recenter, ...rest } = params;
    Object.assign(settings, rest);

    if (Object.prototype.hasOwnProperty.call(rest, 'sequence')){
      setSequence(rest.sequence);
    }

    if (typeof rest.slice === 'number'){
      uniforms.uSlice.value = rest.slice;
      uniforms.uSliceBase.value = rest.slice;
    }
    if (typeof rest.iterations === 'number'){
      uniforms.uIters.value = rest.iterations | 0;
    }
    if (typeof rest.fold === 'number'){
      uniforms.uFoldStrength.value = rest.fold;
    }
    if (typeof rest.roughness === 'number'){
      uniforms.uRoughness.value = rest.roughness;
    }
    if (typeof rest.exposure === 'number'){
      uniforms.uExposure.value = rest.exposure;
    }
    if (typeof rest.bloom === 'number'){
      settings.bloom = rest.bloom;
      updateBloomPipeline();
    }
    if (typeof rest.bailout === 'number'){
      uniforms.uBailout.value = rest.bailout;
    }
    if (typeof rest.sliceAmplitude === 'number'){
      settings.sliceAmplitude = rest.sliceAmplitude;
    }
    if (typeof rest.cLoopScale === 'number'){
      settings.cLoopScale = rest.cLoopScale;
    }
    let cameraChanged = false;
    if (typeof rest.cameraDistance === 'number'){
      settings.cameraDistance = rest.cameraDistance;
      cameraChanged = true;
    }
    if (typeof rest.cameraAzimuth === 'number'){
      settings.cameraAzimuth = rest.cameraAzimuth;
      cameraChanged = true;
    }
    if (typeof rest.cameraElevation === 'number'){
      settings.cameraElevation = rest.cameraElevation;
      cameraChanged = true;
    }
    if (cameraChanged){
      updateCameraFromSettings();
      updateCameraUniforms();
    }
    if (Object.prototype.hasOwnProperty.call(rest, 'reducedMotion')){
      hasReducedOverride = true;
      cleanup.forEach(fn => { try { fn(); } catch (e) { /* noop */ } });
      cleanup.length = 0;
      updateReducedUniform();
    }
    syncAnimUniforms();
    if (recenter){
      recenterFractal();
    }
    requestRender();
  }

  function dispose(){
    cleanup.forEach(fn => { try { fn(); } catch (e) { /* noop */ } });
    composer?.dispose();
    fxaaPass?.dispose?.();
    bloomPass?.dispose?.();
    quad.geometry.dispose();
    material.dispose();
    renderer.dispose();
  }

  return { resize, pause, resume, setSequence, setParams, dispose };
}
