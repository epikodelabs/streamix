import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { map, pipe, scan, scope, tap } from "@epikodelabs/streamix";
import { on } from "@epikodelabs/streamix/dom";

const RAINBOW_DRAW_DURATION = 2200;

interface Milestone {
  id: string;
  label: string;
  done: boolean;
}

interface AppState {
  count: number;
  name: string;
  greeting: string;
  pageScale: number;
  pageOffsetY: number;
  pageTransform: string;
  isPartyTime: boolean;
  redWidth: string;
  orangeWidth: string;
  yellowWidth: string;
  greenWidth: string;
  blueWidth: string;
  message: string;
  celebration: string;
  milestones: readonly Milestone[];
}

const model = scope<AppState>({
  count: 0,
  name: "",
  greeting: self => (self.name ? `Hi, ${self.name}! 🌈` : "Type your name"),
  pageScale: 1,
  pageOffsetY: 0,
  pageTransform: self => `translate(-50%, -50%) translateY(${self.pageOffsetY}px) scale(${self.pageScale})`,
  isPartyTime: self => self.count > 0 && self.count % 5 === 0,
  redWidth: self => `${15 + (self.count * 7) % 86}%`,
  orangeWidth: self => `${15 + (self.count * 11) % 86}%`,
  yellowWidth: self => `${15 + (self.count * 13) % 86}%`,
  greenWidth: self => `${15 + (self.count * 17) % 86}%`,
  blueWidth: self => `${15 + (self.count * 19) % 86}%`,
  message: self => messageFor(self.count),
  celebration: self => (self.count >= 5 ? "Rainbow unlocked! 🌈" : ""),
  milestones: self => [
    { id: "start", label: "First click", done: self.count >= 1 },
    { id: "five", label: "Rainbow grow", done: self.count >= 5 },
    { id: "ten", label: "Double digits", done: self.count >= 10 },
  ],
});

function messageFor(count: number): string {
  if (count === 0) return "The rainbow is waiting for you.";
  if (count === 5) return "Watch it grow! 🌈";
  if (count > 5 && count % 5 === 0) return "Party time! Another five! 🎉";
  return "Nice! Click again to move the colors.";
}

function fitPage(page: HTMLElement | null): void {
  if (!page) return;
  const viewportPadding = 16;
  const availableWidth = Math.max(1, window.innerWidth - viewportPadding * 2);
  const inspector = document.querySelector<HTMLElement>('[data-streamix-inspector]:not([data-collapsed])');
  const bottom = inspector ? inspector.getBoundingClientRect().top : window.innerHeight;
  const availableHeight = Math.max(1, bottom - viewportPadding * 2);

  // offsetWidth/offsetHeight report the natural, untransformed page size.
  // That lets us preserve the original layout and scale it only when needed.
  const naturalWidth = Math.max(1, page.offsetWidth);
  const naturalHeight = Math.max(1, page.offsetHeight);
  const scale = Math.min(
    1,
    availableWidth / naturalWidth,
    availableHeight / naturalHeight,
  );

  model.pageScale = scale;
  model.pageOffsetY = (bottom - window.innerHeight) / 2;
}

function resizeCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const context = canvas.getContext("2d");
  context?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  canvas?.getContext("2d")?.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

function drawRainbow(canvas: HTMLCanvasElement | null, progress: number): void {
  const context = canvas?.getContext("2d");
  if (!context) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  context.clearRect(0, 0, width, height);

  const colors = [
    "#ff3b30",
    "#ff9500",
    "#ffcc00",
    "#34c759",
    "#00a7e1",
    "#5856d6",
    "#af52de",
  ];

  const bandWidth = Math.max(16, Math.min(34, Math.min(width, height) * 0.032));
  const gap = Math.max(2, bandWidth * 0.08);
  const centerX = width / 2;
  const centerY = height * 0.95;
  const outerRadius = Math.max(width * 0.58, height * 0.72);

  context.save();
  context.lineCap = "round";
  context.globalCompositeOperation = "source-over";

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

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const rainbow = useRef({ active: false, progress: 0, stop: undefined as (() => void) | undefined });

  const stopRainbowAnimation = () => {
    const stop = rainbow.current.stop;
    rainbow.current.stop = undefined;
    stop?.();
  };

  const startRainbow = () => {
    stopRainbowAnimation();
    rainbow.current.progress = 0;

    const draw = (progress: number) => {
      rainbow.current.progress = progress;
      drawRainbow(canvasRef.current, progress);
    };

    rainbow.current.stop = pipe(
      on("animationFrame"),
      scan((elapsed, delta) => elapsed + delta, 0),
      map(elapsed => Math.min(elapsed / RAINBOW_DRAW_DURATION, 1)),
      tap(draw),
    ).subscribe(progress => {
      if (progress >= 1) {
        stopRainbowAnimation();
      }
    });
  };

  useEffect(() => {
    resizeCanvas(canvasRef.current);
    fitPage(pageRef.current);
    const layout = new ResizeObserver(() => fitPage(pageRef.current));
    if (pageRef.current) layout.observe(pageRef.current);
    const inspector = document.querySelector<HTMLElement>('[data-streamix-inspector]');
    if (inspector) layout.observe(inspector);

    const viewport = pipe(
      on("viewportChange"),
      tap(() => {
        resizeCanvas(canvasRef.current);
        fitPage(pageRef.current);
        if (rainbow.current.active) {
          drawRainbow(canvasRef.current, rainbow.current.progress);
        }
      }),
    ).subscribe();

    return () => {
      layout.disconnect();
      stopRainbowAnimation();
      viewport();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="rainbow-canvas"
        aria-hidden="true"
      ></canvas>

      <main ref={pageRef} style={{ transform: model.pageTransform }}>
        <p className="tiny-title">Streamix + React</p>
        <h1>Make the rainbow grow!</h1>
        <label className="name-field">
          Name
          <input value={model.name} onChange={event => model.name = event.target.value} placeholder="your name" />
        </label>
        <p className="greeting">{model.greeting}</p>
        <p>Click the big button. The number and colors will move.</p>

        <section className={model.isPartyTime ? "number-box active" : "number-box"}>
          <span className="number">{model.count}</span>
          <span>clicks</span>
        </section>

        <button
          type="button"
          onClick={() => {
            const next = model.count + 1;
            model.count = next;

            if (next === 5) {
              rainbow.current.active = true;
              startRainbow();
            }
          }}
        >
          Click me! ✨
        </button>
        <button
          type="button"
          className="reset"
          onClick={() => {
            model.count = 0;
            rainbow.current.active = false;
            rainbow.current.progress = 0;
            stopRainbowAnimation();
            clearCanvas(canvasRef.current);
          }}
        >
          Start over
        </button>

        <section className="rainbow" aria-label="Growing rainbow">
          <i className="red" style={{ width: model.redWidth }}></i>
          <i className="orange" style={{ width: model.orangeWidth }}></i>
          <i className="yellow" style={{ width: model.yellowWidth }}></i>
          <i className="green" style={{ width: model.greenWidth }}></i>
          <i className="blue" style={{ width: model.blueWidth }}></i>
        </section>

        <p className="message">{model.message}</p>

        {model.count > 0 && model.count % 5 !== 0 ? (
          <p className="hint">{5 - model.count % 5} more to unlock the rainbow</p>
        ) : null}

        <ul className="milestones">
          {model.milestones.map((milestone: Milestone) => (
            <li key={milestone.id}>
              {milestone.done ? <s>{milestone.label}</s> : <span>{milestone.label}</span>}
            </li>
          ))}
        </ul>
      </main>

      <div className="celebration-slot" aria-live="polite">
        {model.celebration ? <strong className="celebration">{model.celebration}</strong> : null}
      </div>
    </>
  );
}

const host = document.getElementById("app");
if (!host) {
  throw new Error("Missing #app host element.");
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
