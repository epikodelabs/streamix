import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { atom, derived } from '@epikodelabs/streamix';
import {
  SxClassBindingsDirective,
  SxStyleBindingsDirective,
  SxTextDirective,
} from '@epikodelabs/streamix/angular';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SxTextDirective, SxClassBindingsDirective, SxStyleBindingsDirective],
  template: `
    <canvas
      #rainbowCanvas
      class="rainbow-canvas"
      aria-hidden="true"
    ></canvas>

    <main>
      <p class="tiny-title">Streamix + Angular</p>
      <h1>Make the rainbow grow!</h1>
      <p>Click the big button. The number and colors will move.</p>

      <section class="number-box" [sx.class.active]="isPartyTime">
        <span class="number" [sx.text]="count"></span>
        <span>clicks</span>
      </section>

      <button type="button" (click)="addClick()">Click me! ✨</button>
      <button type="button" class="reset" (click)="reset()">Start over</button>

      <section class="rainbow" aria-label="Growing rainbow">
        <i class="red" [sx.style.width]="redWidth"></i>
        <i class="orange" [sx.style.width]="orangeWidth"></i>
        <i class="yellow" [sx.style.width]="yellowWidth"></i>
        <i class="green" [sx.style.width]="greenWidth"></i>
        <i class="blue" [sx.style.width]="blueWidth"></i>
      </section>

      <p class="message" [sx.text]="message"></p>
    </main>
  `,
  styles: [`
    :host { display:grid; min-height:100vh; place-items:center; background:#f1f8ff; color:#26324d; font-family:system-ui, sans-serif; text-align:center; position:relative; overflow:hidden; }
    .rainbow-canvas { position:fixed; inset:0; width:100%; height:100%; pointer-events:none; opacity:.78; z-index:0; }
    main { position:relative; z-index:1; width:min(92vw, 520px); padding:34px 22px; }
    .tiny-title { color:#6b74a7; font-weight:700; letter-spacing:.12em; text-transform:uppercase; font-size:.75rem; } h1 { font-size:clamp(2rem, 8vw, 3.5rem); margin:.2em 0; } p { color:#586683; }
    .number-box { display:grid; place-items:center; margin:25px auto 18px; width:165px; height:165px; border-radius:50%; background:white; border:8px solid #d9e8ff; box-shadow:0 8px 22px #7597c638; } .number-box.active { border-color:#9f75ff; transform:rotate(4deg) scale(1.05); } .number { display:block; font-size:4rem; font-weight:900; line-height:1; color:#6041c7; }
    button { border:0; border-radius:999px; padding:13px 23px; font-size:1rem; font-weight:800; cursor:pointer; background:#6041c7; color:white; box-shadow:0 5px 0 #44279b; } button:active { transform:translateY(4px); box-shadow:0 1px 0 #44279b; } .reset { background:transparent; color:#586683; box-shadow:none; margin-left:8px; font-weight:600; }
    .rainbow { display:grid; gap:9px; margin:35px 0 18px; } .rainbow i { display:block; height:18px; min-width:8px; border-radius:999px; transition:width .16s ease; } .red { background:#ff6b6b; } .orange { background:#ff9f43; } .yellow { background:#feca57; } .green { background:#43c59e; } .blue { background:#4d96ff; } .message { font-size:1.08rem; font-weight:700; min-height:1.5em; }
  `],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('rainbowCanvas', { static: true })
  private rainbowCanvas!: ElementRef<HTMLCanvasElement>;

  readonly count = atom(0);
  readonly isPartyTime = derived($ => $(this.count) > 0 && $(this.count) % 10 === 0);
  readonly redWidth = derived($ => `${15 + ($(this.count) * 7) % 86}%`);
  readonly orangeWidth = derived($ => `${15 + ($(this.count) * 11) % 86}%`);
  readonly yellowWidth = derived($ => `${15 + ($(this.count) * 13) % 86}%`);
  readonly greenWidth = derived($ => `${15 + ($(this.count) * 17) % 86}%`);
  readonly blueWidth = derived($ => `${15 + ($(this.count) * 19) % 86}%`);
  readonly message = derived($ => messageFor($(this.count)));

  private animationFrame = 0;
  private rainbowProgress = 0;
  private rainbowActive = false;
  private readonly onResize = () => {
    this.resizeCanvas();
    if (this.rainbowActive) this.drawRainbow(this.rainbowProgress);
  };

  ngAfterViewInit(): void {
    this.resizeCanvas();
    window.addEventListener('resize', this.onResize, { passive: true });
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
    cancelAnimationFrame(this.animationFrame);
  }

  addClick(): void {
    const next = this.count.value + 1;
    this.count.set(next);

    if (next === 5) {
      this.rainbowActive = true;
      this.animateRainbow();
    }
  }

  reset(): void {
    this.count.set(0);
    this.rainbowActive = false;
    this.rainbowProgress = 0;
    cancelAnimationFrame(this.animationFrame);
    this.clearCanvas();
  }

  private animateRainbow(): void {
    cancelAnimationFrame(this.animationFrame);
    this.rainbowProgress = 0;

    const duration = 2200;
    const startedAt = performance.now();

    const frame = (now: number) => {
      const elapsed = now - startedAt;
      this.rainbowProgress = Math.min(elapsed / duration, 1);
      this.drawRainbow(this.rainbowProgress);

      if (this.rainbowProgress < 1) {
        this.animationFrame = requestAnimationFrame(frame);
      }
    };

    this.animationFrame = requestAnimationFrame(frame);
  }

  private resizeCanvas(): void {
    const canvas = this.rainbowCanvas.nativeElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext('2d');
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private clearCanvas(): void {
    const canvas = this.rainbowCanvas.nativeElement;
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  private drawRainbow(progress: number): void {
    const canvas = this.rainbowCanvas.nativeElement;
    const context = canvas.getContext('2d');
    if (!context) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    context.clearRect(0, 0, width, height);

    const colors = [
      '#ff3b30',
      '#ff9500',
      '#ffcc00',
      '#34c759',
      '#00a7e1',
      '#5856d6',
      '#af52de',
    ];

    const bandWidth = Math.max(16, Math.min(34, Math.min(width, height) * 0.032));
    const gap = Math.max(2, bandWidth * 0.08);
    const centerX = width / 2;
    const centerY = height * 0.95;
    const outerRadius = Math.max(width * 0.58, height * 0.72);
    const totalBands = colors.length;

    context.save();
    context.lineCap = 'round';
    context.globalCompositeOperation = 'source-over';

    for (let index = 0; index < totalBands; index += 1) {
      // Stagger every band slightly so the individual color lines visibly grow.
      const delay = index * 0.055;
      const local = Math.max(0, Math.min(1, (progress - delay) / (1 - delay)));
      if (local <= 0) continue;

      const eased = 1 - Math.pow(1 - local, 3);
      const radius = outerRadius - index * (bandWidth + gap);
      const endAngle = Math.PI + Math.PI * eased;

      context.beginPath();
      context.arc(centerX, centerY, radius, Math.PI, endAngle, false);
      context.strokeStyle = colors[index];
      context.lineWidth = bandWidth;
      context.globalAlpha = 0.86;
      context.shadowColor = colors[index];
      context.shadowBlur = bandWidth * 0.45;
      context.stroke();
    }

    context.restore();
  }
}

function messageFor(count: number): string {
  if (count === 0) return 'The rainbow is waiting for you.';
  if (count === 10) return 'Watch it grow! 🌈';
  if (count > 10 && count % 10 === 0) return 'Party time! Another ten! 🎉';
  return 'Nice! Click again to move the colors.';
}
