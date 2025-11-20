/* -----------------------------------------------------------
 * Quasicrystal Explorer  — streamed point-cloud renderer
 * (external ES-module “main.js”)
 * - random rejection sampling in a Web Worker
 * - chunk streaming (5 k points) into a single BufferGeometry
 * - camera auto-frames on first batch
 * - constant-size glyphs for visibility when inside the cloud
 * --------------------------------------------------------- */

import * as THREE from "three";
import { OrbitControls } from "three/examples/controls/OrbitControls.js";
import { STLExporter } from "three/examples/exporters/STLExporter.js";
import { GUI } from "lil-gui";

/* ---------- constants & cut-and-project data ---------- */
const PHI = (1 + Math.sqrt(5)) / 2;
const N = Math.sqrt(2 + PHI); // Normalization constant
const v = (...xs) => new Float32Array(xs.map(x => x / N));

const STRUCTURES = {
  Icosahedral: {
    dim: 6,
    P: v(1, PHI, 0, -1, -PHI, 0,
      PHI, 0, 1, -PHI, 0, -1,
      0, 1, PHI, 0, -1, -PHI),
    W: v(-PHI, 1, 0, -PHI, -1, 0,
      0, -PHI, 1, 0, -PHI, -1,
      1, 0, -PHI, 1, 0, -PHI)
  },
  Octagonal: {
    dim: 4,
    P: new Float32Array([
      1, Math.SQRT2 / 2, 0, -Math.SQRT2 / 2,
      0, Math.SQRT2 / 2, 1, Math.SQRT2 / 2,
      -Math.SQRT2 / 2, 0, Math.SQRT2 / 2, -1]),
    W: new Float32Array([
      1, -Math.SQRT2 / 2, 0, Math.SQRT2 / 2,
      0, -Math.SQRT2 / 2, 1, -Math.SQRT2 / 2,
      Math.SQRT2 / 2, 0, -Math.SQRT2 / 2, -1])
  },
  Danzer: {
    dim: 6,
    P: v(1, PHI, 0, 0, -PHI, -1,
      0, 1, PHI, -1, 0, -PHI,
      PHI, 0, 1, -PHI, -1, 0),
    W: v(1, -PHI, 0, 0, PHI, -1,
      0, 1, -PHI, 1, 0, -PHI,
      -PHI, 0, 1, PHI, -1, 0)
  }
};
STRUCTURES.Decagonal = STRUCTURES.Icosahedral;
STRUCTURES.Dodecagonal = STRUCTURES.Octagonal;

/* ---------- DOM helpers ---------- */
const $ = sel => document.querySelector(sel);
const setStatus = txt => { $("#status").textContent = txt; };
const setProgress = val => { $("#progress").value = val; };

/* ---------- THREE.js scene ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

renderer.domElement.addEventListener("webglcontextlost",
  e => { e.preventDefault(); alert("WebGL context lost"); });

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableZoom = true;
controls.enablePan = true;
controls.target.set(0, 0, 0);

// Initial camera position (Front view for centering check)
camera.position.set(0, 0, 80);
camera.lookAt(0, 0, 0);
camera.lookAt(0, 0, 0);
controls.update();

const cluster = new THREE.Group();
scene.add(cluster);

// DEBUG: Visual Helpers
const axesHelper = new THREE.AxesHelper(50);
scene.add(axesHelper);

const gridHelper = new THREE.GridHelper(100, 10);
scene.add(gridHelper);

// DEBUG: Origin Sphere (The absolute center)
const originGeo = new THREE.SphereGeometry(1, 32, 32);
const originMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const originSphere = new THREE.Mesh(originGeo, originMat);
scene.add(originSphere);

/* ---------- global buffers ---------- */
let positions, geo, cloud, accepted = 0;
// ... (lines 90-307)


const pointsMat = new THREE.PointsMaterial({
  color: 0xffd700,
  size: 0.1,
  sizeAttenuation: true
});

/* ---------- GUI ---------- */
const params = {
  structure: "Icosahedral",
  clipRadius: 20,
  range: 22,
  perpWindow: 2.5,
  targetNodes: 20000, // Minimum for debugging
  insideFrac: 0.07, // camera start offset
  viewOffsetX: 0,
  viewOffsetY: 0
};

const gui = new GUI();
gui.add(params, "structure", Object.keys(STRUCTURES)).onChange(build);
gui.add(params, "clipRadius", 6, 25, 1).onChange(v => {
  params.range = Math.ceil(v * 1.1); // keep sphere complete
  build();
});
gui.add(params, "range", 4, 30, 1).onChange(build);
gui.add(params, "perpWindow", 0.5, 4, 0.1).onChange(build);
gui.add(params, "targetNodes", 20000, 400000, 20000).onChange(build);

const camFolder = gui.addFolder("Camera Offset");
camFolder.add(params, "viewOffsetX", -50, 50, 0.1).onChange(updateCameraTarget);
camFolder.add(params, "viewOffsetY", -50, 50, 0.1).onChange(updateCameraTarget);
// gui.close(); // Keep open for debugging

function updateCameraTarget() {
  controls.target.set(params.viewOffsetX, params.viewOffsetY, 0);
  controls.update();
}

/* ---------- Worker (random sampling, chunk stream) ---------- */
const workerCode = `
  function dot(r,v){let s=0;for(let i=0;i<v.length;i++)s+=r[i]*v[i];return s;}
  onmessage = e => {
    const {dim,P,W,range,perpWin,clipR,target,chunk} = e.data;
    const row = i => P.slice(i*dim,(i+1)*dim);
    const P0=row(0), P1=row(1), P2=row(2),
          W0=W.slice(0,dim), W1=W.slice(dim,2*dim), W2=W.slice(2*dim,3*dim);
    const rnd = () => Math.floor(Math.random() * (2 * range + 1)) - range;

    let pointsFound = 0;
    let totalAccepted = 0;
    let out = new Float32Array(chunk * 3); // Create buffer once per chunk

    while (totalAccepted < target) {
      const v = new Int16Array(dim); for (let i=0;i<dim;i++) v[i]=rnd();

      const px = dot(P0,v), py = dot(P1,v), pz = dot(P2,v);
      const wx = dot(W0,v), wy = dot(W1,v), wz = dot(W2,v);

      // --- FIXED: Use a spherical acceptance window instead of a cubic one. ---
      if (wx*wx + wy*wy + wz*wz > perpWin*perpWin) continue;
      
      if (px*px + py*py + pz*pz > clipR*clipR) continue;

      out[pointsFound * 3]     = px;
      out[pointsFound * 3 + 1] = py;
      out[pointsFound * 3 + 2] = pz;
      pointsFound++;
      totalAccepted++;

      if (pointsFound === chunk) {
        postMessage({t:'chunk', buf: out.buffer}, [out.buffer]);
        out = new Float32Array(chunk * 3); // Allocate the next chunk
        pointsFound = 0;
      }
    }
    // Post the last, partially filled chunk
    if (pointsFound > 0) {
        const finalChunk = out.slice(0, pointsFound * 3);
        postMessage({t:'chunk', buf: finalChunk.buffer}, [finalChunk.buffer]);
    }

    postMessage({t:'done'});
  };
`;

const worker = new Worker(
  URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" })),
  { type: "module" }
);

worker.onmessage = ({ data: { t, buf } }) =>
  t === "chunk" ? appendChunk(buf)
    : setStatus(`Done (${accepted.toLocaleString()} pts)`);

/* ---------- build / append / frame ---------- */
function build() {
  setStatus("Building…"); setProgress(0); accepted = 0;

  if (cloud) {
    cluster.remove(cloud);
    geo.dispose();
  }

  positions = new Float32Array(params.targetNodes * 3);
  geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);

  cloud = new THREE.Points(geo, pointsMat);
  cluster.add(cloud);

  const cfg = STRUCTURES[params.structure];
  worker.postMessage({
    dim: cfg.dim,
    P: cfg.P,
    W: cfg.W,
    range: params.range,
    perpWin: params.perpWindow,
    clipR: params.clipRadius,
    target: params.targetNodes,
    chunk: 5000
  });

  firstChunk = true;
}

let firstChunk = true;
function appendChunk(buf) {
  const chunk = new Float32Array(buf);
  const remain = params.targetNodes - accepted;
  const addPts = Math.min(remain, chunk.length / 3);
  if (addPts <= 0) return;

  positions.set(chunk.subarray(0, addPts * 3), accepted * 3);
  accepted += addPts;

  geo.attributes.position.needsUpdate = true;
  geo.setDrawRange(0, accepted);

  // Auto-framing removed to keep camera fixed at (0,0,60)
  if (firstChunk) {
    firstChunk = false;
    camera.lookAt(0, 0, 0);
  }
  setProgress(accepted / params.targetNodes);

  // DEBUG: Calculate Bounding Box & Centroid
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  let sumX = 0, sumY = 0, sumZ = 0;

  for (let i = 0; i < addPts; i++) {
    const x = chunk[i * 3];
    const y = chunk[i * 3 + 1];
    const z = chunk[i * 3 + 2];

    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;

    sumX += x;
    sumY += y;
    sumZ += z;
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;

  const avgX = sumX / addPts;
  const avgY = sumY / addPts;
  const avgZ = sumZ / addPts;

  console.log(`Chunk stats (${addPts} pts):`);
  console.log(`  Bounding Box Center: [${centerX.toFixed(4)}, ${centerY.toFixed(4)}, ${centerZ.toFixed(4)}]`);
  console.log(`  Centroid (Average):  [${avgX.toFixed(4)}, ${avgY.toFixed(4)}, ${avgZ.toFixed(4)}]`);
  console.log(`  Camera Pos:`, camera.position);
  console.log(`  Controls Target:`, controls.target);
}

/* ---------- STL export ---------- */
$("#download").addEventListener("click", () => {
  if (!accepted) return;

  setStatus("Exporting STL...");

  setTimeout(() => {
    const sphereGeom = new THREE.SphereGeometry(0.05, 6, 6);
    const sphereVertices = sphereGeom.getAttribute('position');
    const sphereNormals = sphereGeom.getAttribute('normal');

    const totalVertices = sphereVertices.count * accepted;
    const mergedPositions = new Float32Array(totalVertices * 3);
    const mergedNormals = new Float32Array(totalVertices * 3);
    const tempVertex = new THREE.Vector3();

    let offset = 0;
    for (let i = 0; i < accepted; i++) {
      const point = new THREE.Vector3(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2]
      );

      for (let j = 0; j < sphereVertices.count; j++) {
        tempVertex.fromBufferAttribute(sphereVertices, j).add(point);
        mergedPositions[offset * 3] = tempVertex.x;
        mergedPositions[offset * 3 + 1] = tempVertex.y;
        mergedPositions[offset * 3 + 2] = tempVertex.z;

        tempVertex.fromBufferAttribute(sphereNormals, j);
        mergedNormals[offset * 3] = tempVertex.x;
        mergedNormals[offset * 3 + 1] = tempVertex.y;
        mergedNormals[offset * 3 + 2] = tempVertex.z;

        offset++;
      }
    }

    const mergedGeometry = new THREE.BufferGeometry();
    mergedGeometry.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
    mergedGeometry.setAttribute('normal', new THREE.BufferAttribute(mergedNormals, 3));

    const mesh = new THREE.Mesh(mergedGeometry);
    const exporter = new STLExporter();
    const result = exporter.parse(mesh, { binary: true });
    const blob = new Blob([result], { type: 'model/stl' });

    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `${params.structure}.stl`
    });
    document.body.appendChild(a);
    a.click();
    a.remove();

    setStatus(`Done (${accepted.toLocaleString()} pts)`);
  }, 10);
});


/* ---------- lighting ---------- */
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
scene.add(new THREE.DirectionalLight(0xffffff, 1)).position.set(40, 30, 25);

/* ---------- animation loop ---------- */
function animate() {
  requestAnimationFrame(animate);
  // cluster.rotation.y += 0.001;
  // cluster.rotation.x += 0.00025;
  controls.update();
  renderer.render(scene, camera);
}
animate();

// DEBUG: Log origin projection
setInterval(() => {
  const vec = new THREE.Vector3(0, 0, 0);
  vec.project(camera);

  const canvas = renderer.domElement;
  const x = (vec.x * .5 + .5) * canvas.clientWidth;
  const y = (-(vec.y * .5) + .5) * canvas.clientHeight;

  console.log('--- Projection Debug ---');
  console.log(`NDC: [${vec.x.toFixed(4)}, ${vec.y.toFixed(4)}]`);
  console.log(`Screen Pixel: [${x.toFixed(1)}, ${y.toFixed(1)}] / [${canvas.clientWidth}, ${canvas.clientHeight}]`);
  console.log(`Center should be: [${canvas.clientWidth / 2}, ${canvas.clientHeight / 2}]`);
  console.log(`Diff: [${(x - canvas.clientWidth / 2).toFixed(1)}, ${(y - canvas.clientHeight / 2).toFixed(1)}]`);
}, 100);

/* ---------- resize ---------- */
function onWindowResize() {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (width === 0 || height === 0) return;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height, false);

  console.log(`Canvas Style: ${canvas.style.width} x ${canvas.style.height}`);
  console.log(`Canvas Client: ${width} x ${height}`);
  console.log(`Canvas Buffer: ${canvas.width} x ${canvas.height}`);
}
addEventListener("resize", onWindowResize);

/* ---------- kick things off ---------- */
// Wait for DOM to be ready to avoid forced layout warnings
addEventListener("DOMContentLoaded", () => {
  // Force initial resize to ensure correct aspect ratio
  onWindowResize();
  // Double check after layout settles (e.g. scrollbars appearing/disappearing)
  setTimeout(onWindowResize, 100);
  build();
});