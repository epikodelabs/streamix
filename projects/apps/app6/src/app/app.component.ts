import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import {
  map,
  pipe,
  scan,
  scope,
  tap,
  type Subscription,
} from '@epikodelabs/streamix';
import { on } from '@epikodelabs/streamix/dom';

const RAINBOW_DRAW_DURATION = 2200;

interface AppState {
  count: number;
  pageScale: number;
  pageTransform: string;
  isPartyTime: boolean;
  redWidth: string;
  orangeWidth: string;
  yellowWidth: string;
  greenWidth: string;
  blueWidth: string;
  message: string;
  celebration: string;
}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas
      #rainbowCanvas
      class="rainbow-canvas"
      aria-hidden="true"
    ></canvas>

    <main #page [style.transform]="model.pageTransform">
      <p class="tiny-title">Streamix + Angular</p>
      <h1>Make the rainbow grow!</h1>
      <p>Click the big button. The number and colors will move.</p>

      <section class="number-box" [class.active]="model.isPartyTime">
        <span class="number">{{ model.count }}</span>
        <span>clicks</span>
      </section>

      <button type="button" (click)="addClick()">Click me! ✨</button>
      <button type="button" class="reset" (click)="reset()">Start over</button>

      <section class="rainbow" aria-label="Growing rainbow">
        <i class="red" [style.width]="model.redWidth"></i>
        <i class="orange" [style.width]="model.orangeWidth"></i>
        <i class="yellow" [style.width]="model.yellowWidth"></i>
        <i class="green" [style.width]="model.greenWidth"></i>
        <i class="blue" [style.width]="model.blueWidth"></i>
      </section>

      <p class="message">{{ model.message }}</p>
    </main>

    <div class="celebration-slot" aria-live="polite">
      @if (model.celebration) {
        <strong class="celebration">{{ model.celebration }}</strong>
      }
    </div>
  `,
  styles: [`
    :host { display:grid; width:100%; height:100dvh; place-items:center; background:#f1f8ff; color:#26324d; font-family:system-ui, sans-serif; text-align:center; position:relative; overflow:hidden; }
    .rainbow-canvas { position:fixed; inset:0; width:100%; height:100%; pointer-events:none; opacity:.78; z-index:0; }
    main { position:relative; z-index:1; width:min(92vw, 520px); padding:34px 22px; box-sizing:border-box; transform-origin:center center; will-change:transform; }
    .tiny-title { color:#6b74a7; font-weight:700; letter-spacing:.12em; text-transform:uppercase; font-size:.75rem; } h1 { font-size:clamp(2rem, 8vw, 3.5rem); margin:.2em 0; } p { color:#586683; }
    .number-box { display:grid; place-items:center; margin:25px auto 18px; width:165px; height:165px; border-radius:50%; background:white; border:8px solid #d9e8ff; box-shadow:0 8px 22px #7597c638; } .number-box.active { border-color:#9f75ff; transform:rotate(4deg) scale(1.05); } .number { display:block; font-size:4rem; font-weight:900; line-height:1; color:#6041c7; }
    button { border:0; border-radius:999px; padding:13px 23px; font-size:1rem; font-weight:800; cursor:pointer; background:#6041c7; color:white; box-shadow:0 5px 0 #44279b; } button:active { transform:translateY(4px); box-shadow:0 1px 0 #44279b; } .reset { background:transparent; color:#586683; box-shadow:none; margin-left:8px; font-weight:600; }
    .rainbow { display:grid; gap:9px; margin:35px 0 18px; } .rainbow i { display:block; height:18px; min-width:8px; border-radius:999px; transition:width .16s ease; } .red { background:#ff6b6b; } .orange { background:#ff9f43; } .yellow { background:#feca57; } .green { background:#43c59e; } .blue { background:#4d96ff; } .message { font-size:1.08rem; font-weight:700; min-height:1.5em; }
    .celebration-slot { position:fixed; left:50%; bottom:22px; z-index:2; transform:translateX(-50%); pointer-events:none; } .celebration { display:block; padding:10px 16px; border-radius:999px; background:rgba(255,255,255,.88); color:#6041c7; box-shadow:0 8px 24px #4b3b7a2b; backdrop-filter:blur(8px); white-space:nowrap; }
  `],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('rainbowCanvas', { static: true })
  private rainbowCanvas!: ElementRef<HTMLCanvasElement>;

  @ViewChild('page', { static: true })
  private page!: ElementRef<HTMLElement>;

  readonly model = scope<AppState>({
    count: 0,
    pageScale: 1,
    pageTransform: self => `scale(${self.pageScale})`,
    isPartyTime: self => self.count > 0 && self.count % 5 === 0,
    redWidth: self => `${15 + (self.count * 7) % 86}%`,
    orangeWidth: self => `${15 + (self.count * 11) % 86}%`,
    yellowWidth: self => `${15 + (self.count * 13) % 86}%`,
    greenWidth: self => `${15 + (self.count * 17) % 86}%`,
    blueWidth: self => `${15 + (self.count * 19) % 86}%`,
    message: self => messageFor(self.count),
    celebration: self =>
      self.count >= 5 ? 'Rainbow unlocked! 🌈' : '',
  });

  private animation?: Subscription;
  private viewport?: Subscription;
  private rainbowProgress = 0;
  private rainbowActive = false;

  ngAfterViewInit(): void {
    this.resizeCanvas();
    this.fitPage();

    this.viewport = pipe(
      on('viewportChange'),
      tap(() => {
        this.resizeCanvas();
        this.fitPage();
        if (this.rainbowActive) {
          this.drawRainbow(this.rainbowProgress);
        }
      }),
    ).subscribe();
  }

  ngOnDestroy(): void {
    this.stopRainbowAnimation();
    this.viewport?.();
    this.viewport = undefined;
  }

  addClick(): void {
    const next = this.model.count + 1;
    this.model.count = next;

    if (next === 5) {
      this.rainbowActive = true;
      this.animateRainbow();
    }
  }

  reset(): void {
    this.model.count = 0;
    this.rainbowActive = false;
    this.rainbowProgress = 0;
    this.stopRainbowAnimation();
    this.clearCanvas();
  }

  private animateRainbow(): void {
    this.stopRainbowAnimation();
    this.rainbowProgress = 0;

    this.animation = pipe(
      on('animationFrame'),
      scan((elapsed, delta) => elapsed + delta, 0),
      map(elapsed => Math.min(elapsed / RAINBOW_DRAW_DURATION, 1)),
      tap(progress => {
        this.rainbowProgress = progress;
        this.drawRainbow(progress);
      }),
    ).subscribe(progress => {
      if (progress >= 1) {
        this.stopRainbowAnimation();
      }
    });
  }

  private stopRainbowAnimation(): void {
    const animation = this.animation;
    this.animation = undefined;
    animation?.();
  }

  private fitPage(): void {
    const page = this.page.nativeElement;
    const viewportPadding = 16;
    const availableWidth = Math.max(1, window.innerWidth - viewportPadding * 2);
    const availableHeight = Math.max(1, window.innerHeight - viewportPadding * 2);

    // offsetWidth/offsetHeight report the natural, untransformed page size.
    // That lets us preserve the original layout and scale it only when needed.
    const naturalWidth = Math.max(1, page.offsetWidth);
    const naturalHeight = Math.max(1, page.offsetHeight);
    const scale = Math.min(
      1,
      availableWidth / naturalWidth,
      availableHeight / naturalHeight,
    );

    this.model.pageScale = scale;
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

    context.save();
    context.lineCap = 'round';
    context.globalCompositeOperation = 'source-over';

    for (let index = 0; index < colors.length; index += 1) {
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
  if (count === 5) return 'Watch it grow! 🌈';
  if (count > 5 && count % 5 === 0) return 'Party time! Another five! 🎉';
  return 'Nice! Click again to move the colors.';
}
