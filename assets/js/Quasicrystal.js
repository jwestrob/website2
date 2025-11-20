import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Quasicrystal {
    constructor(containerElement) {
        this.container = containerElement;
        this.workers = [];
        
        this.params = {
            structure: "Icosahedral",
            radius: 13.0,
            density: 100000,
            chunkSize: 20000,
            speed: 1.0,
            phason: 0.0,
            useVertexColors: false, 
            // Slicing Params
            sliceEnabled: false,
            sliceAxis: 'z', // x, y, or z
            slicePos: 0.0,
            sliceThickness: 1.0,
            autoScan: false,
            concurrency: navigator.hardwareConcurrency || 4
        };

        // Math Constants
        const PHI = (1 + Math.sqrt(5)) / 2;
        const N = Math.sqrt(2 + PHI);
        const v = (...xs) => xs.map(x => x / N);

        this.STRUCTURES = {
            Icosahedral: {
                dim: 6,
                P: v(1, PHI, 0, -1, -PHI, 0,
                     PHI, 0, 1, -PHI, 0, -1,
                     0, 1, PHI, 0, -1, -PHI),
                W: v(-PHI, 1, 0, -PHI, -1, 0,
                     0, -PHI, 1, 0, -PHI, -1,
                     1, 0, -PHI, 1, 0, -PHI)
            }
        };

        this.init();
    }

    init() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        
        // CRITICAL: Enable clipping for the CT-Scan effect
        this.renderer.localClippingEnabled = true;
        
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050505);

        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.01, 1000);
        this.updateCameraZoom();

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = this.params.speed;

        // --- CLIPPING PLANES (The "Sandwich") ---
        // We define two planes facing each other to create a slice
        this.planeBottom = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this.planeTop = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
        this.clippingPlanes = [this.planeBottom, this.planeTop];

        // --- GEOMETRY ---
        this.geometry = new THREE.BufferGeometry();
        this.maxPoints = 1000000; 
        
        this.positions = new Float32Array(this.maxPoints * 3);
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        
        this.colors = new Float32Array(this.maxPoints * 3);
        this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

        this.geometry.setDrawRange(0, 0);

        // --- MATERIAL ---
        const material = new THREE.PointsMaterial({
            color: 0xffd700,
            size: 0.15,
            vertexColors: false,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending,
            depthTest: true,
            transparent: true,
            opacity: 0.9,
            clippingPlanes: [], // Start empty (disabled)
            clipIntersection: false
        });

        this.cloud = new THREE.Points(this.geometry, material);
        this.scene.add(this.cloud);

        this.injectUI();
        this.startBuild();

        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.container);
        this.renderer.setAnimationLoop(() => this.animate());
    }

    injectUI() {
        const style = document.createElement('style');
        style.innerHTML = `
            .qc-ui-container {
                position: absolute; top: 20px; right: 20px;
                display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
                font-family: monospace; color: #eee; z-index: 1000;
            }
            .qc-toggle {
                width: 40px; height: 40px;
                background: rgba(10,10,10,0.9);
                border: 1px solid #444; border-radius: 4px;
                color: #ffd700; cursor: pointer;
                display: flex; justify-content: center; align-items: center;
                font-size: 24px; font-weight: bold; transition: 0.2s;
            }
            .qc-toggle:hover { background: #222; border-color: #ffd700; }
            .qc-panel {
                width: 300px; background: rgba(10,10,10,0.95);
                backdrop-filter: blur(10px); border: 1px solid #333; border-radius: 8px;
                padding: 15px; 
                display: flex; flex-direction: column; gap: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                transition: opacity 0.3s, transform 0.3s;
            }
            .qc-panel.hidden {
                opacity: 0; pointer-events: none; transform: translateY(-10px);
                position: absolute;
            }
            .qc-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
            .qc-input { width: 45%; background: #222; border: 1px solid #444; color: #fff; padding: 4px; border-radius: 4px; }
            .qc-range { -webkit-appearance: none; width: 50%; height: 4px; background: #444; border-radius: 2px; outline: none; }
            .qc-range::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; background: #ffd700; border-radius: 50%; cursor: pointer; }
            
            /* Custom Toggle Switch */
            .qc-switch { position: relative; display: inline-block; width: 34px; height: 18px; }
            .qc-switch input { opacity: 0; width: 0; height: 0; }
            .qc-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #444; transition: .4s; border-radius: 18px; }
            .qc-slider:before { position: absolute; content: ""; height: 12px; width: 12px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
            input:checked + .qc-slider { background-color: #ffd700; }
            input:checked + .qc-slider:before { transform: translateX(16px); background-color: black; }

            .qc-btn {
                background: #ffd700; color: #000; border: none; padding: 10px;
                font-weight: bold; cursor: pointer; border-radius: 4px;
                text-transform: uppercase; letter-spacing: 1px; transition: 0.2s; text-align: center;
            }
            .qc-btn:hover { background: #fff; }
            .qc-btn:disabled { background: #333; color: #888; cursor: wait; border: 1px solid #444; }
            
            .qc-progress-container { width: 100%; height: 6px; background: #222; border-radius: 3px; overflow: hidden; margin-top: 5px; border: 1px solid #333; }
            .qc-progress-bar { 
                width: 0%; height: 100%; 
                background: linear-gradient(45deg, #ffd700 25%, #ffea00 25%, #ffea00 50%, #ffd700 50%, #ffd700 75%, #ffea00 75%, #ffea00 100%);
                background-size: 20px 20px; animation: qc-stripe 1s linear infinite; transition: width 0.2s; 
            }
            @keyframes qc-stripe { 0% { background-position: 0 0; } 100% { background-position: 20px 20px; } }
            
            .qc-divider { height: 1px; background: #333; margin: 5px 0; }
            .qc-note { font-size: 10px; color: #888; text-align: right; margin-top: -8px; }
        `;
        document.head.appendChild(style);

        const wrapper = document.createElement('div');
        wrapper.className = 'qc-ui-container';
        
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'qc-toggle';
        toggleBtn.innerHTML = '×';

        this.panel = document.createElement('div');
        this.panel.className = 'qc-panel';
        this.panel.innerHTML = `
            <div class="qc-row">
                <label>RADIUS</label>
                <input type="number" id="qc-radius" class="qc-input" value="${this.params.radius}" min="5" max="50" step="1">
            </div>
            <div class="qc-row">
                <label>DENSITY</label>
                <select id="qc-density" class="qc-input">
                    <option value="50000">Low (50k)</option>
                    <option value="100000" selected>Med (100k)</option>
                    <option value="250000">High (250k)</option>
                    <option value="500000">Ultra (500k)</option>
                </select>
            </div>
            <div class="qc-row">
                <label>COLOR MODE</label>
                <select id="qc-colormode" class="qc-input">
                    <option value="gold" selected>Standard Gold</option>
                    <option value="spectral">Spectral Heatmap</option>
                </select>
            </div>
            <div class="qc-row">
                <label title="Perpendicular Space Shift">PHASON DRIFT</label>
                <input type="range" id="qc-phason" class="qc-range" min="-4.0" max="4.0" step="0.1" value="${this.params.phason}">
            </div>
            <div class="qc-note">(Requires Re-Render)</div>

            <div class="qc-divider"></div>

            <div class="qc-row">
                <label style="color:#ffd700">ENABLE SLICING</label>
                <label class="qc-switch">
                    <input type="checkbox" id="qc-slice-toggle">
                    <span class="qc-slider"></span>
                </label>
            </div>
            <div id="qc-slice-controls" style="opacity:0.3; pointer-events:none; transition:0.3s">
                <div class="qc-row">
                    <label>AUTO-SCAN (CT MODE)</label>
                    <label class="qc-switch">
                        <input type="checkbox" id="qc-scan-toggle">
                        <span class="qc-slider"></span>
                    </label>
                </div>
                <div class="qc-row">
                    <label>SLICE POSITION</label>
                    <input type="range" id="qc-slice-pos" class="qc-range" min="-15" max="15" step="0.1" value="${this.params.slicePos}">
                </div>
                <div class="qc-row">
                    <label>SLICE THICKNESS</label>
                    <input type="range" id="qc-slice-thick" class="qc-range" min="0.1" max="5.0" step="0.1" value="${this.params.sliceThickness}">
                </div>
            </div>

            <div class="qc-divider"></div>

            <div class="qc-row">
                <label>ROTATION SPEED</label>
                <input type="range" id="qc-speed" class="qc-range" min="0" max="5" step="0.1" value="${this.params.speed}">
            </div>

            <button id="qc-render" class="qc-btn">RE-RENDER</button>
            <div class="qc-progress-container">
                <div id="qc-progress" class="qc-progress-bar"></div>
            </div>
        `;

        wrapper.appendChild(toggleBtn);
        wrapper.appendChild(this.panel);
        this.container.appendChild(wrapper);

        // --- Event Listeners ---
        
        // Toggle Panel
        let isVisible = true;
        toggleBtn.addEventListener('click', () => {
            isVisible = !isVisible;
            if (isVisible) {
                this.panel.classList.remove('hidden');
                toggleBtn.innerHTML = '×';
            } else {
                this.panel.classList.add('hidden');
                toggleBtn.innerHTML = '≡';
            }
        });

        // Slicing Toggles
        const sliceGroup = this.panel.querySelector('#qc-slice-controls');
        this.panel.querySelector('#qc-slice-toggle').addEventListener('change', (e) => {
            this.params.sliceEnabled = e.target.checked;
            sliceGroup.style.opacity = this.params.sliceEnabled ? '1' : '0.3';
            sliceGroup.style.pointerEvents = this.params.sliceEnabled ? 'all' : 'none';
            
            if (this.params.sliceEnabled) {
                this.cloud.material.clippingPlanes = this.clippingPlanes;
            } else {
                this.cloud.material.clippingPlanes = [];
            }
            this.cloud.material.needsUpdate = true;
        });

        this.panel.querySelector('#qc-scan-toggle').addEventListener('change', (e) => {
            this.params.autoScan = e.target.checked;
        });

        this.panel.querySelector('#qc-slice-pos').addEventListener('input', (e) => {
            this.params.slicePos = parseFloat(e.target.value);
            // Disable auto-scan if user moves slider manually
            if (this.params.autoScan) {
                this.params.autoScan = false;
                this.panel.querySelector('#qc-scan-toggle').checked = false;
            }
        });

        this.panel.querySelector('#qc-slice-thick').addEventListener('input', (e) => {
            this.params.sliceThickness = parseFloat(e.target.value);
        });


        // Standard Controls
        this.panel.querySelector('#qc-colormode').addEventListener('change', (e) => {
            const mode = e.target.value;
            this.params.useVertexColors = (mode === 'spectral');
            this.updateMaterialMode();
        });

        this.panel.querySelector('#qc-speed').addEventListener('input', (e) => {
            this.params.speed = parseFloat(e.target.value);
            if (this.controls) this.controls.autoRotateSpeed = this.params.speed;
        });

        this.panel.querySelector('#qc-phason').addEventListener('input', (e) => {
            this.params.phason = parseFloat(e.target.value);
        });

        this.panel.querySelector('#qc-render').addEventListener('click', () => {
            this.params.radius = parseFloat(this.panel.querySelector('#qc-radius').value);
            this.params.density = parseInt(this.panel.querySelector('#qc-density').value);
            this.startBuild();
        });

        this.progressBar = this.panel.querySelector('#qc-progress');
        this.renderBtn = this.panel.querySelector('#qc-render');
    }

    updateMaterialMode() {
        if (this.params.useVertexColors) {
            this.cloud.material.color.setHex(0xffffff);
            this.cloud.material.vertexColors = true;
        } else {
            this.cloud.material.color.setHex(0xffd700);
            this.cloud.material.vertexColors = false;
        }
        this.cloud.material.needsUpdate = true;
    }

    updateCameraZoom() {
        const fov = this.camera.fov * (Math.PI / 180);
        const camDist = (this.params.radius * 2.2) / Math.tan(fov / 2);
        if (this.controls) {
            const dir = this.camera.position.clone().normalize();
            this.camera.position.copy(dir.multiplyScalar(camDist));
        } else {
            this.camera.position.set(camDist, camDist * 0.5, camDist);
        }
    }

    startBuild() {
        this.workers.forEach(w => w.terminate());
        this.workers = [];

        this.acceptedCount = 0;
        this.geometry.setDrawRange(0, 0);
        
        this.progressBar.style.width = '0%';
        this.renderBtn.disabled = true;
        this.renderBtn.textContent = "INITIALIZING...";
        
        this.updateMaterialMode();
        this.updateCameraZoom();
        
        const optimalRange = Math.ceil(this.params.radius) + 1;
        
        // Also update the UI range slider min/max to match the new radius
        const posSlider = this.panel.querySelector('#qc-slice-pos');
        posSlider.min = -this.params.radius;
        posSlider.max = this.params.radius;

        const workerCode = `
            onmessage = e => {
                const { dim, P, W, range, perpWin, clipR, chunk, phason, seed } = e.data;
                const row = (arr, i) => arr.slice(i*dim, (i+1)*dim);
                const P0=row(P,0), P1=row(P,1), P2=row(P,2);
                const W0=row(W,0), W1=row(W,1), W2=row(W,2);
                const perpWinSq = perpWin * perpWin;
                const clipRSq = clipR * clipR;
                const range2 = range * 2 + 1;

                let pointsFound = 0;
                let batch = new Float32Array(chunk * 6);
                const v = new Int16Array(dim);
                let s = seed;

                while (true) {
                    for(let i=0; i<dim; i++) {
                        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
                        v[i] = (((s >>> 0) * 2.3283064365386963e-10) * range2 | 0) - range;
                    }

                    let wx = phason + W0[0]*v[0] + W0[1]*v[1] + W0[2]*v[2] + W0[3]*v[3] + W0[4]*v[4] + W0[5]*v[5];
                    let wDistSq = wx*wx;
                    if (wDistSq > perpWinSq) continue;

                    let wy = phason + W1[0]*v[0] + W1[1]*v[1] + W1[2]*v[2] + W1[3]*v[3] + W1[4]*v[4] + W1[5]*v[5];
                    wDistSq += wy*wy;
                    if (wDistSq > perpWinSq) continue;

                    let wz = phason + W2[0]*v[0] + W2[1]*v[1] + W2[2]*v[2] + W2[3]*v[3] + W2[4]*v[4] + W2[5]*v[5];
                    wDistSq += wz*wz;
                    if (wDistSq > perpWinSq) continue;

                    let px = P0[0]*v[0] + P0[1]*v[1] + P0[2]*v[2] + P0[3]*v[3] + P0[4]*v[4] + P0[5]*v[5];
                    let py = P1[0]*v[0] + P1[1]*v[1] + P1[2]*v[2] + P1[3]*v[3] + P1[4]*v[4] + P1[5]*v[5];
                    let pz = P2[0]*v[0] + P2[1]*v[1] + P2[2]*v[2] + P2[3]*v[3] + P2[4]*v[4] + P2[5]*v[5];
                    
                    if (px*px + py*py + pz*pz > clipRSq) continue;

                    const t = Math.sqrt(wDistSq) / perpWin;
                    let r, g, b;
                    if (t < 0.5) {
                        const localT = t * 2.0;
                        r = 0.0 * (1-localT) + 0.5 * localT;
                        g = 1.0 * (1-localT) + 0.0 * localT;
                        b = 1.0 * (1-localT) + 1.0 * localT;
                    } else {
                        const localT = (t - 0.5) * 2.0;
                        r = 0.5 * (1-localT) + 1.0 * localT;
                        g = 0.0 * (1-localT) + 0.0 * localT;
                        b = 1.0 * (1-localT) + 0.2 * localT;
                    }

                    const idx = pointsFound * 6;
                    batch[idx]=px; batch[idx+1]=py; batch[idx+2]=pz;
                    batch[idx+3]=r; batch[idx+4]=g; batch[idx+5]=b;

                    pointsFound++;
                    if (pointsFound === chunk) {
                        postMessage({ type: 'chunk', buffer: batch.buffer }, [batch.buffer]);
                        batch = new Float32Array(chunk * 6);
                        pointsFound = 0;
                    }
                }
            };
        `;

        const blob = new Blob([workerCode], { type: "text/javascript" });
        const blobURL = URL.createObjectURL(blob);
        const cfg = this.STRUCTURES[this.params.structure];

        for (let i = 0; i < this.params.concurrency; i++) {
            const worker = new Worker(blobURL);
            worker.onmessage = (e) => this.handleWorkerMessage(e);
            const seed = Math.floor(Math.random() * 4294967296) + i;
            worker.postMessage({
                dim: cfg.dim, P: cfg.P, W: cfg.W,
                range: optimalRange,
                perpWin: 1.5,
                clipR: this.params.radius,
                phason: this.params.phason,
                chunk: this.params.chunkSize,
                seed: seed
            });
            this.workers.push(worker);
        }
    }

    handleWorkerMessage(e) {
        if (this.acceptedCount >= this.params.density) return;

        if (e.data.type === 'chunk') {
            const chunkData = new Float32Array(e.data.buffer);
            const pointsInChunk = chunkData.length / 6;
            
            const posArr = this.geometry.attributes.position.array;
            const colArr = this.geometry.attributes.color.array;
            
            const remaining = this.params.density - this.acceptedCount;
            const toAdd = Math.min(remaining, pointsInChunk);
            
            for(let i=0; i<toAdd; i++) {
                const globalIdx = (this.acceptedCount + i) * 3;
                const localIdx = i * 6;
                
                posArr[globalIdx]   = chunkData[localIdx];
                posArr[globalIdx+1] = chunkData[localIdx+1];
                posArr[globalIdx+2] = chunkData[localIdx+2];
                
                colArr[globalIdx]   = chunkData[localIdx+3];
                colArr[globalIdx+1] = chunkData[localIdx+4];
                colArr[globalIdx+2] = chunkData[localIdx+5];
            }

            this.acceptedCount += toAdd;

            this.geometry.attributes.position.needsUpdate = true;
            this.geometry.attributes.color.needsUpdate = true;
            this.geometry.setDrawRange(0, this.acceptedCount);

            const progress = Math.round((this.acceptedCount / this.params.density) * 100);
            this.progressBar.style.width = `${progress}%`;
            this.renderBtn.textContent = `GENERATING... ${progress}%`;

            if (this.acceptedCount >= this.params.density) {
                this.workers.forEach(w => w.terminate());
                this.workers = [];
                this.renderBtn.disabled = false;
                this.renderBtn.textContent = "RE-RENDER";
            }
        }
    }

    onResize() {
        if (!this.container || !this.camera || !this.renderer) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    animate() {
        this.controls.update();
        
        // Handle CT-Scan Slicing Logic
        if (this.params.sliceEnabled) {
            let zPos = this.params.slicePos;

            // Auto Scan Animation
            if (this.params.autoScan) {
                const time = Date.now() * 0.001;
                zPos = Math.sin(time) * (this.params.radius * 0.8); // Oscillate
                
                // Update UI slider to reflect auto movement
                this.panel.querySelector('#qc-slice-pos').value = zPos;
                this.params.slicePos = zPos;
            }

            // Update Clipping Planes
            // Plane 1 (Bottom): Normal (0,0,1) -> Keeps Z > Constant
            // We want Z > (zPos - thickness/2) -> Constant = zPos - thickness/2
            this.planeBottom.constant = -(zPos - this.params.sliceThickness/2);
            
            // Plane 2 (Top): Normal (0,0,-1) -> Keeps Z < Constant (wait, opposite)
            // Plane math: ax + by + cz + d = 0.
            // Normal (0,0,1), constant C: z + C = 0 => z = -C. 
            // ThreeJS Plane: dot(normal, point) + constant > 0 is VISIBLE.
            
            // Bottom Plane: Normal(0,0,1). Visible if z + C > 0 => z > -C.
            // We want z > zPos - thick/2. So -C = zPos - thick/2 => C = -(zPos - thick/2).
            this.planeBottom.constant = -(zPos - this.params.sliceThickness / 2);

            // Top Plane: Normal(0,0,-1). Visible if -z + C > 0 => z < C.
            // We want z < zPos + thick/2. So C = zPos + thick/2.
            this.planeTop.constant = (zPos + this.params.sliceThickness / 2);
        }

        this.renderer.render(this.scene, this.camera);
    }
}