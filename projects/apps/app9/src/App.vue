<script setup lang="ts">
import {
  atom, debounce, derived, distinctUntilChanged,
  filter, from, interval, map, pipe, scan, startWith, tap, throttle,
} from "@epikodelabs/streamix";
import { onMounted, onUnmounted, ref } from "vue";
import {
  CANVAS_CSS_HEIGHT, CANVAS_CSS_WIDTH, FLINCH_DURATION_MS, INITIAL_FRAME,
  THOUGHTS, THOUGHT_TICKS, TRICK_DURATION_MS, TRICK_EXTRA_RAD_PER_SEC,
  configureCanvas, drawFrame, frameDelta, isNearTriangle, nextFrame, pixelSize, requestGpuDevice, resizeCanvas, sameSize,
  type CanvasSize, type Frame, type GpuContext, type Pointer,
} from "./model";

// ── What the template may show. "starting" while the adapter is negotiated,
// "ready" once we hold a device, "unavailable" when the browser has none. ──
type DeviceState =
  | { phase: "starting" }
  | { phase: "ready"; device: GPUDevice }
  | { phase: "unavailable" };

// ── 1. GPU boot. WebGPU init is one async step that fails when the browser
// has no adapter, so it is modeled as a short stream: `from(() => …)` starts
// the request, `tap` forwards the arrival into the status atom, and the
// atom's onError channel covers the no-WebGPU case. (`from` over a promise
// completes after its single emission, so completion itself is not an error
// — only a failing request is.) ──
const deviceState = atom<DeviceState>({ phase: "starting" });
let unavailableReason = "";
const gpuBoot = pipe(
  from(() => requestGpuDevice()),
  tap((device) => deviceState.next({ phase: "ready", device })),
);
gpuBoot.onError((error) => {
  unavailableReason = String(error?.message ?? error);
  deviceState.next({ phase: "unavailable" });
});

// ── 2. Backbuffer sizing. Window resizes arrive in bursts, so they are
// debounced and compared before touching the canvas — reconfiguring a
// GPUCanvasContext twice per drag-frame is work nobody notices and nobody needs. ──
const resizeTicks = atom(0);
const size = pipe(
  resizeTicks,
  debounce(150),
  map(() => pixelSize(window.devicePixelRatio)),
  distinctUntilChanged(sameSize),
  startWith<CanvasSize>(pixelSize(window.devicePixelRatio)),
);

// ── 3. Pointer. pointermove fires at input-device speed, far past what a
// ~30 fps triangle can perform. `throttle` keeps a leading sample plus one
// trailing sample per 50 ms window, `distinctUntilChanged` drops repeats.
// It starts in a corner; the triangle prefers some notice before company. ──
const rawPointer = atom<Pointer>({ x: 48, y: 48 });
const pointer = pipe(
  rawPointer,
  throttle(50),
  distinctUntilChanged((a, b) => a.x === b.x && a.y === b.y),
  startWith<Pointer>({ x: 48, y: 48 }),
);

// ── Stage directions: trick requests and accidental clicks. Plain writable
// atoms (initialized, so always safe to read from inside the scan). ──
const flair = atom({ trickAt: 0, flinchAt: 0, tricks: 0 });
const RELUCTANCE = ["do a trick", "do another trick", "again?", "it's tired", "SERIOUSLY. it's tired", "fine. one more"];
const doTrick = () => flair.set({ trickAt: Date.now(), flinchAt: flair.value.flinchAt, tricks: flair.value.tricks + 1 });
const flinch = () => flair.set({ trickAt: flair.value.trickAt, flinchAt: Date.now(), tricks: flair.value.tricks });

// ── 4. The animation itself. `interval(16)` is only a HEARTBEAT — the
// pipeline's way of asking "what does the triangle look like now?" about
// sixty times a second. `interval` is not an accurate clock (browsers clamp
// it, throttle it, and jitter it), so the answer never trusts the tick: the
// rotation and drift advance by real elapsed time inside `nextFrame`. If
// ticks come late or in bursts, the motion stays exactly as fast as it
// should be — sampling density changes, speed does not. `filter`ed so a
// hidden tab asks nothing at all, and `scan` holding the whole frame state.
// The target is read from `rawPointer` — the writable atom is initialized
// at creation, so its value is always finite. Reading the *piped* pointer
// here would race the throttle's first emission and poison the offset with
// NaN on the very first tick. While a trick is running the triangle spins a
// little faster, allegedly on purpose; a flinch shakes it briefly. It
// recovers. It always recovers. ──
const frames = pipe(
  interval(16),
  filter(() => !document.hidden),
  scan((frame: Frame) => {
    const now = Date.now();
    const dt = frameDelta(frame, now);
    const show = flair.value;
    let next = nextFrame(frame, rawPointer.value, now);
    if (now - show.trickAt < TRICK_DURATION_MS) {
      next = { ...next, angle: (next.angle + TRICK_EXTRA_RAD_PER_SEC * (dt / 1000)) % (Math.PI * 2) };
    }
    if (now - show.flinchAt < FLINCH_DURATION_MS) {
      const shake = 0.05 * (1 - (now - show.flinchAt) / FLINCH_DURATION_MS);
      next = {
        ...next,
        offset: {
          x: next.offset.x + (Math.random() - 0.5) * shake,
          y: next.offset.y + (Math.random() - 0.5) * shake,
        },
      };
    }
    return next;
  }, INITIAL_FRAME),
);

// ── Readouts. All derived; all dull. ──
const statusLabel = derived(() => {
  const state = deviceState;
  if (state.phase === "ready") return "WebGPU: ready";
  if (state.phase === "unavailable") {
    return `WebGPU: unavailable (${unavailableReason}) — please enjoy this text instead of a triangle`;
  }
  return "WebGPU: warming up…";
});
const angleLabel = derived(() => `${Math.round((frames.angle * 180) / Math.PI)}°`);
const tickLabel = derived(() => `${frames.ticks}`);
const pointerLabel = derived(() => `${Math.round(pointer.x)}, ${Math.round(pointer.y)}`);
const uptimeLabel = derived(() => {
  // When the tab is hidden the filter in the frame pipe pauses everything,
  // so this clock rests when the triangle rests.
  return `${Math.floor((Date.now() - frames.startedAt) / 1000)}s`;
});
// The inner monologue runs on pipeline ticks, so the thoughts rest when the
// triangle rests. Event thoughts override the rotation ones briefly: being
// clicked, being asked to perform, and being perceived, in that order.
// Every input is read BEFORE branching — a derived tracks whatever it read
// on its last evaluation, so an early return would silently drop the rest
// and freeze the thought on whatever was showing when the branch fired.
const thoughtLabel = derived(() => {
  const now = Date.now();
  const ticks = frames.ticks;
  const near = isNearTriangle(pointer);
  const { trickAt, flinchAt } = flair;
  if (now - flinchAt < FLINCH_DURATION_MS) return "sorry. i flinched.";
  if (now - trickAt < TRICK_DURATION_MS) return "that was the trick. there are no others.";
  if (near) return "…i can sense you";
  return THOUGHTS[Math.floor(ticks / THOUGHT_TICKS) % THOUGHTS.length];
});
const trickLabel = derived(() => RELUCTANCE[Math.min(flair.tricks, RELUCTANCE.length - 1)]);
const tricksLabel = derived(() => `${flair.tricks}`);

// ── DOM + GPU wiring. The pipes above are pure Streamix; the canvas is glue.
// No manual double-buffering: a WebGPU canvas is backed by a compositor
// swapchain, so getCurrentTexture/submit is already an atomic present. The
// rAF loop below exists only to keep the present cadence matched to the
// compositor (a bare timer presents at 2:1 and the spare frame can blink). ──
const canvasEl = ref<HTMLCanvasElement | null>(null);
let gpu: GpuContext | null = null;
let cleanups: Array<() => unknown> = [];

onMounted(() => {
  const canvas = canvasEl.value;
  if (!canvas) return;

  const onPointerMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    rawPointer.next({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  const onResize = () => resizeTicks.next(resizeTicks.value + 1);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("resize", onResize);

  const sizeSub = size.subscribe(({ width, height }) => {
    // Assigning canvas.width resets the canvas even when the value is
    // unchanged, so only touch it when the size really moved.
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    if (gpu) resizeCanvas(gpu, canvas, { width, height });
  });

  const deviceSub = deviceState.subscribe((state) => {
    if (state.phase !== "ready" || gpu) return;
    // GPUs can drop a device (driver reset, GPU process crash). The demo
    // does not fight it — it just tells you, which is the dull way.
    state.device.lost.then((info) => {
      unavailableReason = `device lost (${info?.reason ?? "unknown"})`;
      deviceState.next({ phase: "unavailable" });
    });
    try {
      gpu = configureCanvas(canvas, { width: canvas.width, height: canvas.height }, state.device);
    } catch (error) {
      unavailableReason = String(error?.message ?? error);
      deviceState.next({ phase: "unavailable" });
    }
  });

  // The pipeline advances state on its own heartbeat cadence; a
  // compositor-cadence loop only PRESENTS the latest scanned frame. The
  // triangle still only *moves* when the pipeline ticks; presenting the
  // same triangle twice is not progress.
  let latestFrame: Frame | null = null;
  let rafId = 0;
  const frameSub = frames.subscribe((frame) => { latestFrame = frame; });
  const present = () => {
    if (gpu && latestFrame) drawFrame(gpu, latestFrame);
    rafId = requestAnimationFrame(present);
  };
  rafId = requestAnimationFrame(present);

  cleanups = [
    () => canvas.removeEventListener("pointermove", onPointerMove),
    () => window.removeEventListener("resize", onResize),
    () => cancelAnimationFrame(rafId),
    sizeSub,
    deviceSub,
    frameSub,
  ];
});

onUnmounted(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
});
</script>

<template>
  <main class="scene">
    <header class="scene-header">
      <h1>a dull triangle</h1>
      <p>It rotates. Eventually it notices your cursor. It would not describe itself as happy.</p>
    </header>

    <canvas ref="canvasEl" width="640" height="400" @click="flinch"></canvas>

    <p class="thoughts">&ldquo;{{ thoughtLabel }}&rdquo; &mdash; the triangle</p>

    <section class="readouts">
      <span>{{ statusLabel }}</span>
      <span>how rotated: <strong>{{ angleLabel }}</strong></span>
      <span>times it did the thing: <strong>{{ tickLabel }}</strong></span>
      <span>the cursor (it noticed): <strong>{{ pointerLabel }}</strong></span>
      <span>how long (it's fine): <strong>{{ uptimeLabel }}</strong></span>
      <span>tricks performed (against its will): <strong>{{ tricksLabel }}</strong></span>
    </section>

    <button class="trick" type="button" @click="doTrick">{{ trickLabel }}</button>

    <p class="footnote">If this page looks boring, the pipeline is working correctly. The GPU is used for all of this. All of it.</p>
  </main>
</template>
