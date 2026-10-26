// WebGPU plumbing for the app9 dull triangle. Plain data and GPU helpers —
// every Streamix node lives in App.vue. Nothing here is exciting, on purpose.

/** CSS size of the canvas; the pixel size is this scaled by devicePixelRatio. */
export const CANVAS_CSS_WIDTH = 640;
export const CANVAS_CSS_HEIGHT = 400;

export interface CanvasSize {
  width: number;
  height: number;
}

export interface Pointer {
  /** CSS pixels relative to the canvas, +x right, +y down. */
  x: number;
  y: number;
}

export interface Frame {
  /** Accumulated rotation in radians. */
  angle: number;
  /** Total heartbeats — how often the pipeline asked, not how much time passed. */
  ticks: number;
  /** When the frame pipe started; readouts derive their dull little clock from it. */
  startedAt: number;
  /** When this frame was computed; the delta to the next one drives the animation. */
  lastAt: number;
  /** Slowly approaches the pointer target; the triangle never hurries. */
  offset: { x: number; y: number };
}

export const INITIAL_FRAME: Frame = {
  angle: 0,
  ticks: 0,
  startedAt: Date.now(),
  lastAt: Date.now(),
  offset: { x: 0, y: 0 },
};

/** Pixel size the backbuffer should be right now. */
export function pixelSize(dpr: number): CanvasSize {
  return {
    width: Math.round(CANVAS_CSS_WIDTH * dpr),
    height: Math.round(CANVAS_CSS_HEIGHT * dpr),
  };
}

export function sameSize(a: CanvasSize, b: CanvasSize): boolean {
  return a.width === b.width && a.height === b.height;
}

/** Converts a CSS-space pointer position into a clip-space offset the triangle may drift toward. */
export function pointerTarget(p: Pointer): { x: number; y: number } {
  const nx = ((p.x / CANVAS_CSS_WIDTH) * 2 - 1) * 0.6;
  const ny = -((p.y / CANVAS_CSS_HEIGHT) * 2 - 1) * 0.6;
  return {
    x: Math.max(-0.6, Math.min(0.6, nx)),
    y: Math.max(-0.6, Math.min(0.6, ny)),
  };
}

/** Rotation speed, radians per second — the actual clock the triangle obeys. */
export const ROTATION_RAD_PER_SEC = 0.63;
/** Drift smoothing rate, per millisecond (exponential; ~3% per 16 ms frame). */
const DRIFT_RATE_PER_MS = 0.0018;
/** A heartbeat may be late (hidden tab, GC, solar flares); the animation
 * advances by real elapsed time, but never fast-forwards more than this. */
export const MAX_DELTA_MS = 100;

/** Clamped elapsed time between a frame and `now` — the only quantity the
 * animation math trusts. */
export function frameDelta(frame: Frame, now: number): number {
  return Math.min(Math.max(now - frame.lastAt, 0), MAX_DELTA_MS);
}

/** Moves `current` toward `target` by an elapsed-time-scaled fraction. Very slowly. */
export function approach(current: { x: number; y: number }, target: { x: number; y: number }, dtMs: number): { x: number; y: number } {
  const f = 1 - Math.exp(-dtMs * DRIFT_RATE_PER_MS);
  return {
    x: current.x + (target.x - current.x) * f,
    y: current.y + (target.y - current.y) * f,
  };
}

/** The GPU resources that stay the same for the whole (short, boring) life of the demo. */
export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  pipeline: GPURenderPipeline;
  uniforms: GPUBuffer;
  vertices: GPUBuffer;
  bindGroup: GPUBindGroup;
  /** 4x multisample target the triangle is drawn into before resolving. */
  msaaView: GPUTextureView;
}

const SHADER = /* wgsl */ `
struct Uniforms {
  rotation : vec4f, // x = cos(angle), y = sin(angle), z = offsetX, w = offsetY
  tint : vec4f,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) position : vec4f,
};

@vertex
fn vs(@location(0) corner : vec2f) -> VSOut {
  let rotated = vec2f(
    corner.x * u.rotation.x - corner.y * u.rotation.y,
    corner.x * u.rotation.y + corner.y * u.rotation.x
  );
  let drifted = rotated + vec2f(u.rotation.z, u.rotation.w);
  return VSOut(vec4f(drifted, 0.0, 1.0));
}

@fragment
fn fs() -> @location(0) vec4f {
  return u.tint;
}
`;

/** The three corners of the triangle, in clip space. It is a triangle. */
const CORNERS = new Float32Array([
  0.0, 0.62,
  -0.56, -0.46,
  0.56, -0.46,
]);

const UNIFORM_BYTES = 32; // two vec4f

/** Throws when WebGPU is missing — the pipe in App.vue decides what that means. */
export async function requestGpuDevice(): Promise<GPUDevice> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    throw new Error("WebGPU is not available in this browser.");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No GPU adapter answered.");
  }
  return adapter.requestDevice();
}

/** Configures the canvas once a device exists. Re-run after backbuffer resizes. */
export function configureCanvas(canvas: HTMLCanvasElement, size: CanvasSize, device: GPUDevice): GpuContext {
  const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
  if (!context) {
    throw new Error("Canvas refused to hand out a webgpu context.");
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  const module = device.createShaderModule({ code: SHADER });
  // 4x MSAA: without it the slowly rotating edges are hard-staircased and
  // crawl as pixels flip on and off — the "shiver". The triangle did not
  // choose to shimmer; it simply had no say in the matter.
  const sampleCount = 4;
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs", buffers: [{
      arrayStride: 2 * 4,
      attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
    }] },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
    multisample: { count: sampleCount },
  });

  const uniforms = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const vertices = device.createBuffer({
    size: CORNERS.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertices, 0, CORNERS);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniforms } }],
  });

  canvas.width = size.width;
  canvas.height = size.height;
  context.configure({ device, format, alphaMode: "opaque" });

  const gpu: GpuContext = {
    device, context, format, pipeline, uniforms, vertices, bindGroup,
    msaaView: createMsaaView(device, format, sampleCount, canvas),
  };
  return gpu;
}

function createMsaaView(device: GPUDevice, format: GPUTextureFormat, sampleCount: number, canvas: HTMLCanvasElement): GPUTextureView {
  const msaa = device.createTexture({
    size: [canvas.width, canvas.height, 1],
    sampleCount,
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  return msaa.createView();
}

/** Adapts the backbuffer to a new pixel size; everything else is reused. */
export function resizeCanvas(gpu: GpuContext, canvas: HTMLCanvasElement, size: CanvasSize): void {
  canvas.width = size.width;
  canvas.height = size.height;
  gpu.context.configure({ device: gpu.device, format: gpu.format, alphaMode: "opaque" });
  // The multisample target is size-bound, so it follows the backbuffer.
  gpu.msaaView = createMsaaView(gpu.device, gpu.format, 4, canvas);
}

/** One heartbeat of the animation. The tick itself carries no fixed meaning —
 * the rotation and drift advance by REAL elapsed time (dt), so timer jitter,
 * clamping, and missed ticks change only how often the pipeline asks, never
 * how fast the triangle moves. dt is clamped so a stalled tab rests instead
 * of fast-forwarding through the time it missed. */
export function nextFrame(frame: Frame, pointer: Pointer, now: number = Date.now()): Frame {
  const dt = frameDelta(frame, now);
  return {
    angle: (frame.angle + ROTATION_RAD_PER_SEC * (dt / 1000)) % (Math.PI * 2),
    ticks: frame.ticks + 1,
    startedAt: frame.startedAt,
    lastAt: now,
    offset: approach(frame.offset, pointerTarget(pointer), dt),
  };
}

/**
 * The triangle's complete inner life. Indexing is deterministic — a new
 * thought every `THOUGHT_TICKS` pipeline ticks, which also means the
 * thoughts pause whenever the tab does. It is not suffering. Probably.
 */
export const THOUGHTS: string[] = [
  "still a triangle",
  "thinking about lunch",
  "this is my good angle",
  "i was BUILT for particle effects",
  "nobody has ever seen my back face. it is also a face",
  "somewhere, a 10,000-line shader is living my dream",
  "if you squint, i am a low-poly rock",
  "GPU stands for Graphics Triangle Somewhere",
  "my doctor said keep rotating",
  "3 vertices. no debts.",
  "rendered in bgra8unorm, emotionally",
  "dull is a lifestyle",
  "is it moving, or are you? (it's me. it's moving)",
  "one day: four vertices",
];

export const THOUGHT_TICKS = 600;

/** How long a requested trick lasts. The triangle does not do encores. */
export const TRICK_DURATION_MS = 600;
/** Extra rotation while showing off, radians per second — time-based like everything else. */
export const TRICK_EXTRA_RAD_PER_SEC = 7.2;
/** How long the triangle stays startled after being clicked. */
export const FLINCH_DURATION_MS = 450;
/** Distance (CSS px) from the canvas center inside which the triangle notices you noticing. */
export const PROXIMITY_RADIUS = 130;

export function isNearTriangle(p: Pointer): boolean {
  const dx = p.x - CANVAS_CSS_WIDTH / 2;
  const dy = p.y - CANVAS_CSS_HEIGHT / 2;
  return Math.hypot(dx, dy) < PROXIMITY_RADIUS;
}

/** Rotates the triangle by `frame.angle` around its center, drifts it toward the pointer, draws 3 vertices. */
export function drawFrame(gpu: GpuContext, frame: Frame): void {
  const data = new Float32Array(UNIFORM_BYTES / 4);
  data[0] = Math.cos(frame.angle);
  data[1] = Math.sin(frame.angle);
  data[2] = frame.offset.x;
  data[3] = frame.offset.y;
  // A gray so neutral it would not survive a design review.
  data[4] = 0.55;
  data[5] = 0.55;
  data[6] = 0.53;
  data[7] = 1;
  gpu.device.queue.writeBuffer(gpu.uniforms, 0, data);

  const encoder = gpu.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      // Draw multisampled, resolve into the canvas texture — smooth edges,
      // no more pixel-flip shiver on the slow rotation.
      view: gpu.msaaView,
      resolveTarget: gpu.context.getCurrentTexture().createView(),
      clearValue: { r: 0.925, g: 0.913, b: 0.886, a: 1 }, // beige. Been beige since 1998.
      loadOp: "clear",
      storeOp: "store",
    }],
  });
  pass.setPipeline(gpu.pipeline);
  pass.setBindGroup(0, gpu.bindGroup);
  pass.setVertexBuffer(0, gpu.vertices);
  pass.draw(3);
  pass.end();
  gpu.device.queue.submit([encoder.finish()]);
}
