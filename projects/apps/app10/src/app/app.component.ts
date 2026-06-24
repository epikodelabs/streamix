import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { Subscription, pipe, scope, tap } from '@epikodelabs/streamix';
import { on } from '@epikodelabs/streamix/dom';
interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    rotation: number;
    rotationSpeed: number;
    shape: 'rect' | 'circle';
    restitution: number;
}
const PALETTE = [
    '#ff4d6d',
    '#ff8fa3',
    '#ffb3c1',
    '#c77dff',
    '#9d4edd',
    '#7b2cbf',
    '#3a86ff',
    '#06ffa5',
    '#ffbe0b',
    '#ff9e00',
];
function rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}
function createParticle(x: number, y: number): Particle {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(0.5, 2.5);
    return {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: rand(6, 14),
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        rotation: rand(0, 360),
        rotationSpeed: rand(-8, 8),
        shape: Math.random() > 0.5 ? 'rect' : 'circle',
        restitution: rand(0.6, 0.95),
    };
}
@Component({
    selector: 'app-root',
    standalone: true,
    template: `
    <div class="stage">
      <div class="content">
        <h1>Brownian Motion</h1>
        <p class="subtitle">{{ particles.length }} particles wandering via Streamix</p>
      </div>

      @for (p of particles; track $index) {
        <div
          class="particle"
          [class.circle]="p.shape === 'circle'"
          [style.left.px]="p.x"
          [style.top.px]="p.y"
          [style.width.px]="p.size"
          [style.height.px]="p.size"
          [style.background-color]="p.color"
          [style.transform]="'translate(-50%, -50%) rotate(' + p.rotation + 'deg)'"
        ></div>
      }
    </div>
  `,
    styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: radial-gradient(circle at 50% 50%, #14102e 0%, #070514 100%);
      color: #fff;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
    }

    .stage {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    .content {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      z-index: 10;
      pointer-events: none;
      mix-blend-mode: screen;
    }

    h1 {
      font-size: clamp(2.5rem, 8vw, 5rem);
      margin: 0;
      letter-spacing: -0.04em;
      background: linear-gradient(90deg, #ff9e00, #ff006e, #8338ec, #3a86ff);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .subtitle {
      margin: 12px 0 0;
      font-size: 1rem;
      color: #9d8cb5;
    }

    .particle {
      position: absolute;
      will-change: transform, left, top;
      border-radius: 2px;
      box-shadow: 0 0 10px currentColor;
      opacity: 0.9;
    }

    .particle.circle {
      border-radius: 50%;
    }
  `]
})
export class AppComponent implements OnDestroy {
    private readonly cdr = inject(ChangeDetectorRef);
    particles: Particle[] = [];
    private animation?: Subscription;
    private resize?: Subscription;
    private readonly appScope = scope(() => ({}));
    private width = window.innerWidth;
    private height = window.innerHeight;
    constructor() {
        this.start();
    }
    private resolveCollisions(): void {
        const particles = this.particles;
        for (let i = 0; i < particles.length; i++) {
            const p1 = particles[i];
            for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const distSq = dx * dx + dy * dy;
                const minDist = (p1.size + p2.size) / 2;
                if (distSq <= 0 || distSq >= minDist * minDist) continue;

                const dist = Math.sqrt(distSq);
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = minDist - dist;

                // Separate overlapping positions using size as mass.
                const m1 = p1.size;
                const m2 = p2.size;
                const totalMass = m1 + m2;
                p1.x -= nx * overlap * (m2 / totalMass);
                p1.y -= ny * overlap * (m2 / totalMass);
                p2.x += nx * overlap * (m1 / totalMass);
                p2.y += ny * overlap * (m1 / totalMass);

                // Elastic impulse along collision normal.
                const dvx = p2.vx - p1.vx;
                const dvy = p2.vy - p1.vy;
                const velocityAlongNormal = dvx * nx + dvy * ny;
                if (velocityAlongNormal > 0) continue;

                const restitution = Math.min(p1.restitution, p2.restitution);
                const impulse = -(1 + restitution) * velocityAlongNormal / (1 / m1 + 1 / m2);
                p1.vx -= (impulse / m1) * nx;
                p1.vy -= (impulse / m1) * ny;
                p2.vx += (impulse / m2) * nx;
                p2.vy += (impulse / m2) * ny;
            }
        }
    }

    private start(): void {
        // Seed an initial swarm.
        const cx = this.width / 2;
        const cy = this.height / 2;
        for (let i = 0; i < 300; i++) {
            this.particles.push(createParticle(cx + rand(-200, 200), cy + rand(-200, 200)));
        }
        this.resize = pipe(on('viewportChange'), tap((viewport) => {
            this.width = viewport.width;
            this.height = viewport.height;
        }))
            .subscribe();
        this.appScope.cleanups.add(() => this.resize?.unsubscribe());
        this.animation = pipe(on('animationFrame'), tap(() => {
            for (const p of this.particles) {
                // Brownian kick: small random acceleration.
                p.vx += rand(-0.15, 0.15);
                p.vy += rand(-0.15, 0.15);
                // Soft drag keeps velocities in a sensible range.
                p.vx *= 0.99;
                p.vy *= 0.99;
                // Speed clamp.
                const speed = Math.hypot(p.vx, p.vy);
                const maxSpeed = 3.5;
                if (speed > maxSpeed) {
                    p.vx = (p.vx / speed) * maxSpeed;
                    p.vy = (p.vy / speed) * maxSpeed;
                }
                p.x += p.vx;
                p.y += p.vy;
                p.rotation += p.rotationSpeed;
                // Bounce off edges with elastic restitution.
                if (p.x < 0) {
                    p.x = 0;
                    p.vx *= -p.restitution;
                }
                if (p.x > this.width) {
                    p.x = this.width;
                    p.vx *= -p.restitution;
                }
                if (p.y < 0) {
                    p.y = 0;
                    p.vy *= -p.restitution;
                }
                if (p.y > this.height) {
                    p.y = this.height;
                    p.vy *= -p.restitution;
                }
            }
            this.resolveCollisions();
            this.cdr.detectChanges();
        }))
            .subscribe();
        this.appScope.cleanups.add(() => this.animation?.unsubscribe());
    }
    ngOnDestroy(): void {
        this.appScope.dispose();
        this.particles = [];
    }
}
