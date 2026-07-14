import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import type { Subscription } from '@epikodelabs/streamix';
import { fromEvent, map, pipe, scope, tap, throttle } from '@epikodelabs/streamix';
import { on } from '@epikodelabs/streamix/dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
type Weather = 'sunny' | 'rainy';

interface AppScopeShape {
    weather: Weather;
    setWeather: (w: Weather) => void;
}

@Component({
    selector: 'app-root',
    standalone: true,
    template: `
    <div class="app">
      <header class="header">
        <h1>🌈 Cartoon Landscape</h1>
        <p class="subtitle">Three.js scene powered by streamix animation frames</p>
      </header>

      <div class="controls">
        <button
          [class.active]="weather === 'sunny'"
          (click)="setWeather('sunny')"
        >☀️ Sunshine</button>
        <button
          [class.active]="weather === 'rainy'"
          (click)="setWeather('rainy')"
        >🌧️ Rain</button>
      </div>

      <div class="canvas-wrap">
        <canvas #canvas></canvas>
        <div class="overlay-badge">{{ weather === 'sunny' ? 'Sunny · 24°C' : 'Rainy · 16°C' }}</div>
      </div>

      <footer class="footer">
        <p>Powered by <strong>streamix</strong> · Reactive Three.js rendering</p>
      </footer>
    </div>
  `,
    styles: [`
    :host {
      --bg: #f6f7f9;
      --surface: #ffffff;
      --border: #e2e4e9;
      --text: #1a1d26;
      --text-muted: #6b7280;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --radius: 12px;
      display: block;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .app { max-width: 1100px; margin: 0 auto; padding: 24px; }

    .header { text-align: center; margin-bottom: 20px; }
    .header h1 { font-size: 1.9rem; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.5px; }
    .subtitle { color: var(--text-muted); font-size: 0.9rem; margin: 0; }

    .controls {
      display: flex; justify-content: center; gap: 10px; margin-bottom: 16px;
    }
    .controls button {
      background: var(--surface); border: 1px solid var(--border); color: var(--text);
      padding: 8px 20px; border-radius: 20px; cursor: pointer; font-size: 0.9rem;
      font-weight: 500; transition: all 0.15s;
    }
    .controls button:hover { border-color: var(--accent); background: var(--surface); }
    .controls button.active { background: var(--accent); color: #fff; border-color: var(--accent); }

    .canvas-wrap {
      position: relative;
      border-radius: var(--radius);
      overflow: hidden;
      border: 1px solid var(--border);
      background: #87CEEB;
      aspect-ratio: 16 / 9;
    }
    .canvas-wrap canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    .overlay-badge {
      position: absolute;
      top: 12px; right: 12px;
      background: rgba(255,255,255,0.85);
      backdrop-filter: blur(4px);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text);
      pointer-events: none;
    }

    .footer { text-align: center; margin-top: 24px; }
    .footer p { color: var(--text-muted); font-size: 0.8rem; margin: 0; }
    .footer strong { color: var(--accent); }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
    @ViewChild('canvas')
    canvasRef!: ElementRef<HTMLCanvasElement>;
    private readonly appScope = scope<AppScopeShape>(() => ({
        weather: 'sunny' as Weather,
        setWeather: (self: AppScopeShape) => (w: Weather) => { self.weather = w; },
    }));
    get weather() { return this.appScope.weather; }
    private renderer!: THREE.WebGLRenderer;
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private controls!: OrbitControls;
    private sunGroup!: THREE.Group;
    private rainSystem!: THREE.Points;
    private rainGeo!: THREE.BufferGeometry;
    private rainCount = 2000;
    private rainSpeed: Float32Array = new Float32Array(this.rainCount);
    private clouds: THREE.Group[] = [];
    private trees: THREE.Group[] = [];
    private flowers: THREE.Mesh[] = [];
    private animSub!: Subscription;
    private resizeSub!: Subscription;
    private mouseSub!: Subscription;
    private clock = new THREE.Clock();
    private baseCamPos!: THREE.Vector3;
    private parallaxTarget = { x: 0, y: 0 };
    ngOnInit(): void {
        const unsubscribe = this.appScope.at('weather').subscribe((w) => this.applyWeather(w));
        this.appScope.cleanups.add(() => unsubscribe());
    }
    ngAfterViewInit(): void {
        this.initScene();
        this.startLoop();
    }
    ngOnDestroy(): void {
        this.appScope.dispose();
        this.controls?.dispose();
        this.renderer?.dispose();
        this.rainGeo?.dispose();
    }
    setWeather(w: Weather): void {
        this.appScope.setWeather(w);
    }
    private initScene(): void {
        const canvas = this.canvasRef.nativeElement;
        const wrap = canvas.parentElement!;
        const width = wrap.clientWidth;
        const height = wrap.clientHeight;
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 20, 90);
        // Camera
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
        this.camera.position.set(0, 12, 35);
        // Controls
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
        this.controls.minDistance = 10;
        this.controls.maxDistance = 70;
        this.controls.target.set(0, 3, 0);
        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, 0.55);
        this.scene.add(ambient);
        const sunLight = new THREE.DirectionalLight(0xfff5e1, 1.2);
        sunLight.position.set(15, 25, 10);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.set(2048, 2048);
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 80;
        sunLight.shadow.camera.left = -30;
        sunLight.shadow.camera.right = 30;
        sunLight.shadow.camera.top = 30;
        sunLight.shadow.camera.bottom = -30;
        this.scene.add(sunLight);
        const hemi = new THREE.HemisphereLight(0x87CEEB, 0x66BB6A, 0.4);
        this.scene.add(hemi);
        // Ground
        const groundGeo = new THREE.CircleGeometry(60, 64);
        const groundMat = new THREE.MeshToonMaterial({ color: 0x66BB6A });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
        // Hills (low-poly cartoon mounds)
        const hillPositions = [
            { x: -12, z: -8, s: 4, h: 3 },
            { x: 10, z: -12, s: 5, h: 4 },
            { x: -6, z: -18, s: 6, h: 5 },
            { x: 14, z: -5, s: 3.5, h: 2.5 },
            { x: -18, z: 2, s: 5, h: 3.5 },
            { x: 20, z: 5, s: 4, h: 3 },
            { x: 0, z: -22, s: 7, h: 6 },
        ];
        for (const hp of hillPositions) {
            const hillGeo = new THREE.SphereGeometry(hp.s, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
            const hillMat = new THREE.MeshToonMaterial({ color: 0x81C784 });
            const hill = new THREE.Mesh(hillGeo, hillMat);
            hill.position.set(hp.x, -hp.h * 0.3, hp.z);
            hill.scale.y = hp.h / hp.s;
            hill.receiveShadow = true;
            hill.castShadow = true;
            this.scene.add(hill);
        }
        // Trees
        const treeSpots = [
            { x: -8, z: 2 }, { x: -5, z: 6 }, { x: 7, z: 4 },
            { x: 11, z: -2 }, { x: -12, z: -4 }, { x: 4, z: 8 },
            { x: -3, z: -6 }, { x: 15, z: 6 }, { x: -16, z: 8 },
        ];
        for (const spot of treeSpots) {
            const tree = this.makeTree();
            tree.position.set(spot.x, 0, spot.z);
            const scale = 0.7 + Math.random() * 0.5;
            tree.scale.setScalar(scale);
            tree.rotation.y = Math.random() * Math.PI * 2;
            this.scene.add(tree);
            this.trees.push(tree);
        }
        // Flowers
        for (let i = 0; i < 30; i++) {
            const flower = this.makeFlower();
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * 22;
            flower.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
            flower.rotation.y = Math.random() * Math.PI * 2;
            this.scene.add(flower);
            this.flowers.push(flower);
        }
        // Sun
        this.sunGroup = new THREE.Group();
        const sunGeo = new THREE.SphereGeometry(2.5, 32, 32);
        const sunMat = new THREE.MeshToonMaterial({
            color: 0xFFEB3B,
            emissive: 0xFFB300,
            emissiveIntensity: 0.8,
        });
        const sunMesh = new THREE.Mesh(sunGeo, sunMat);
        this.sunGroup.add(sunMesh);
        // Sun glow (larger transparent sphere)
        const glowGeo = new THREE.SphereGeometry(4, 32, 32);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xFFEB3B,
            transparent: true,
            opacity: 0.15,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        this.sunGroup.add(glow);
        // Sun rays (thin cones)
        for (let i = 0; i < 8; i++) {
            const rayGeo = new THREE.ConeGeometry(0.15, 3, 8);
            const rayMat = new THREE.MeshToonMaterial({ color: 0xFFEB3B, transparent: true, opacity: 0.5 });
            const ray = new THREE.Mesh(rayGeo, rayMat);
            const a = (i / 8) * Math.PI * 2;
            ray.position.set(Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0);
            ray.rotation.z = a - Math.PI / 2;
            this.sunGroup.add(ray);
        }
        this.sunGroup.position.set(18, 18, -12);
        this.scene.add(this.sunGroup);
        // Clouds
        const cloudSpots = [
            { x: -10, y: 14, z: -8 },
            { x: 8, y: 16, z: -15 },
            { x: -5, y: 15, z: -20 },
            { x: 14, y: 13, z: -5 },
            { x: -18, y: 14, z: -12 },
        ];
        for (const cs of cloudSpots) {
            const cloud = this.makeCloud();
            cloud.position.set(cs.x, cs.y, cs.z);
            this.scene.add(cloud);
            this.clouds.push(cloud);
        }
        // Rain
        this.buildRain();
        // Resize handler via reactive stream
        this.resizeSub = pipe(on('resize', wrap), tap(({ width, height }) => {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
        })).subscribe(() => { });
        this.appScope.cleanups.add(() => this.resizeSub?.());
        // Mouse parallax
        this.mouseSub = pipe(fromEvent(canvas, 'mousemove'), throttle(50), map((e: Event) => {
            const me = e as MouseEvent;
            const rect = canvas.getBoundingClientRect();
            const x = (me.clientX - rect.left) / rect.width - 0.5;
            const y = (me.clientY - rect.top) / rect.height - 0.5;
            return { x, y };
        }), tap(({ x, y }) => {
            this.parallaxTarget.x = x * 4;
            this.parallaxTarget.y = -y * 2;
        })).subscribe(() => { });
        this.appScope.cleanups.add(() => this.mouseSub?.());
        this.baseCamPos = this.camera.position.clone();
    }
    private makeTree(): THREE.Group {
        const group = new THREE.Group();
        // Trunk
        const trunkGeo = new THREE.CylinderGeometry(0.2, 0.35, 2, 8);
        const trunkMat = new THREE.MeshToonMaterial({ color: 0x8D6E63 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 1;
        trunk.castShadow = true;
        group.add(trunk);
        // Foliage (3 stacked cones)
        const foliageMat = new THREE.MeshToonMaterial({ color: 0x43A047 });
        const layers = [
            { r: 1.4, h: 1.8, y: 2.4 },
            { r: 1.1, h: 1.6, y: 3.2 },
            { r: 0.7, h: 1.2, y: 3.9 },
        ];
        for (const layer of layers) {
            const geo = new THREE.ConeGeometry(layer.r, layer.h, 8);
            const mesh = new THREE.Mesh(geo, foliageMat);
            mesh.position.y = layer.y;
            mesh.castShadow = true;
            group.add(mesh);
        }
        return group;
    }
    private makeFlower(): THREE.Mesh {
        const geo = new THREE.SphereGeometry(0.15, 8, 8);
        const colors = [0xFF5252, 0xFFEB3B, 0xE040FB, 0xFF9800, 0x448AFF];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const mat = new THREE.MeshToonMaterial({ color });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 0.15;
        return mesh;
    }
    private makeCloud(): THREE.Group {
        const group = new THREE.Group();
        const mat = new THREE.MeshToonMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.95 });
        const blobs = [
            { x: 0, y: 0, z: 0, r: 1.2 },
            { x: 1, y: 0.1, z: 0, r: 0.9 },
            { x: -0.9, y: 0.05, z: 0.2, r: 0.85 },
            { x: 0.3, y: 0.4, z: -0.1, r: 0.7 },
            { x: -0.3, y: 0.3, z: 0.3, r: 0.6 },
        ];
        for (const b of blobs) {
            const geo = new THREE.SphereGeometry(b.r, 12, 10);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(b.x, b.y, b.z);
            group.add(mesh);
        }
        return group;
    }
    private buildRain(): void {
        this.rainGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(this.rainCount * 3);
        for (let i = 0; i < this.rainCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 50;
            positions[i * 3 + 1] = Math.random() * 25 + 5;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
            this.rainSpeed[i] = 0.15 + Math.random() * 0.25;
        }
        this.rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const rainMat = new THREE.PointsMaterial({
            color: 0xB3E5FC,
            size: 0.12,
            transparent: true,
            opacity: 0.7,
        });
        this.rainSystem = new THREE.Points(this.rainGeo, rainMat);
        this.rainSystem.visible = false;
        this.scene.add(this.rainSystem);
    }
    private applyWeather(w: string): void {
        if (!this.scene)
            return;
        const sunny = w === 'sunny';
        // Sky
        this.scene.background = new THREE.Color(sunny ? 0x87CEEB : 0x607D8B);
        this.scene.fog!.color.set(sunny ? 0x87CEEB : 0x607D8B);
        // Sun visibility
        this.sunGroup.visible = sunny;
        // Rain visibility
        this.rainSystem.visible = !sunny;
        // Ground color
        const ground = this.scene.children.find((c) => c instanceof THREE.Mesh && (c.geometry as THREE.CircleGeometry)?.parameters?.radius === 60) as THREE.Mesh | undefined;
        if (ground) {
            (ground.material as THREE.MeshToonMaterial).color.set(sunny ? 0x66BB6A : 0x558B2F);
        }
        // Flowers perk up in sun
        for (const flower of this.flowers) {
            flower.scale.y = sunny ? 1 : 0.6;
        }
    }
    private startLoop(): void {
        this.animSub = pipe(on('animationFrame'), tap(() => {
            const time = this.clock.getElapsedTime();
            // Smooth parallax interpolation
            if (this.baseCamPos) {
                this.camera.position.x += (this.baseCamPos.x + this.parallaxTarget.x - this.camera.position.x) * 0.05;
                this.camera.position.y += (this.baseCamPos.y + this.parallaxTarget.y - this.camera.position.y) * 0.05;
            }
            // Animate sun gentle pulse
            if (this.sunGroup.visible) {
                const s = 1 + Math.sin(time * 1.5) * 0.04;
                this.sunGroup.scale.setScalar(s);
                this.sunGroup.rotation.z = time * 0.1;
            }
            // Animate clouds drifting
            for (let i = 0; i < this.clouds.length; i++) {
                const cloud = this.clouds[i];
                cloud.position.x += Math.sin(time * 0.2 + i * 1.5) * 0.015;
            }
            // Animate rain
            if (this.rainSystem.visible) {
                const positions = this.rainGeo.attributes['position'].array as Float32Array;
                for (let i = 0; i < this.rainCount; i++) {
                    positions[i * 3 + 1] -= this.rainSpeed[i];
                    if (positions[i * 3 + 1] < 0) {
                        positions[i * 3 + 1] = 22 + Math.random() * 8;
                    }
                }
                this.rainGeo.attributes['position'].needsUpdate = true;
            }
            // Gentle flower sway
            for (let i = 0; i < this.flowers.length; i++) {
                const f = this.flowers[i];
                f.position.x += Math.sin(time * 2 + i) * 0.002;
            }
            // Tree gentle sway in rain
            if (this.weather === 'rainy') {
                for (let i = 0; i < this.trees.length; i++) {
                    this.trees[i].rotation.z = Math.sin(time * 3 + i) * 0.015;
                }
            }
            else {
                for (const tree of this.trees) {
                    tree.rotation.z *= 0.95;
                }
            }
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        })).subscribe(() => { });
        this.appScope.cleanups.add(() => this.animSub?.());
    }
}
