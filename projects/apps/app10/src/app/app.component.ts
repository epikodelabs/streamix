import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { Subscription, tap } from '@epikodelabs/streamix';
import { onAnimationFrame, onViewportChange } from '@epikodelabs/streamix/dom';

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

  private width = window.innerWidth;
  private height = window.innerHeight;

  constructor() {
    this.start();
  }

  private start(): void {
    // Seed an initial swarm.
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (let i = 0; i < 300; i++) {
      this.particles.push(createParticle(cx + rand(-200, 200), cy + rand(-200, 200)));
    }

    this.resize = onViewportChange()
      .pipe(
        tap((viewport) => {
          this.width = viewport.width;
          this.height = viewport.height;
        })
      )
      .subscribe();

    this.animation = onAnimationFrame()
      .pipe(
        tap(() => {
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

            // Bounce off edges.
            if (p.x < 0) { p.x = 0; p.vx *= -1; }
            if (p.x > this.width) { p.x = this.width; p.vx *= -1; }
            if (p.y < 0) { p.y = 0; p.vy *= -1; }
            if (p.y > this.height) { p.y = this.height; p.vy *= -1; }
          }

          this.cdr.detectChanges();
        })
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.animation?.unsubscribe();
    this.resize?.unsubscribe();
    this.particles = [];
  }
}
