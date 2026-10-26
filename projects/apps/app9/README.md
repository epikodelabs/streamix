# App 9 — a dull WebGPU triangle

A WebGPU demo that is boring on purpose: one gray triangle rotating on a
beige canvas at ~60 Hz, drifting slowly toward wherever your cursor went,
occasionally sharing what's on its mind ("still a triangle", "one day:
four vertices"). The thoughts run on pipeline ticks, so they pause when the
tab does — resting is part of the lifestyle. If this page looks boring, the
pipeline is working correctly.

The edges are 4× multisampled: without MSAA, a *slowly* rotating triangle's
aliased edges crawl as pixels flip on and off, which reads as a shiver. The
triangle did not choose to shimmer; it simply had no say in the matter.

## It also has a personality, regrettably

- **"do a trick"** — the triangle spins a little faster for 600 ms, allegedly
  on purpose. The button gets progressively less comfortable asking
  ("do another trick" → "again?" → "SERIOUSLY. it's tired" → "fine. one
  more").
- **Click the canvas** — it flinches (a decaying shake, 450 ms) and
  apologizes.
- **Bring the cursor near it** — "…i can sense you".
- Tricks, flinches and thoughts all live in the same `scan`/`derived` state
  as the rotation; nothing here touches the GPU setup.

## Two Streamix lessons this demo paid for

1. **Early returns drop dependencies.** A `derived` tracks whatever it read
   on its *last* evaluation. The first thought implementation returned early
   on the flinch branch — so that evaluation never read `frames.ticks`, the
   derived's dependency set shrank to the flair atom, and the thought froze
   on "sorry. i flinched." forever. Read every input unconditionally, then
   branch.
2. **`interval` is a heartbeat, not a clock.** Browsers clamp, throttle, and
   jitter timers; a fixed step per tick made the animation change speed with
   system load (occluded, it crawled at 1 Hz). Now the tick only decides how
   often the pipeline *asks* — the rotation and drift advance by real
   elapsed time inside the accumulator, clamped so a hidden tab rests
   instead of fast-forwarding. Measured on the running demo: ~58 heartbeats
   per second, 36°/s of rotation in every window, exactly as designed.
3. **Timer-driven canvases blink at 2:1.** A ~30 Hz draw cadence under a
   ~60 Hz compositor meant exactly two presents per draw, and the second
   present could sample the invalidated canvas texture. The fix: the
   pipeline stays the only clock, but a `requestAnimationFrame` loop
   *presents* the latest scanned frame every compositor frame. Presenting
   the same triangle twice is not progress; presenting a blank one is a
   bug.

Every stateful value is a Streamix node, and every pipe uses only operators
that map onto a real GPU concern — nothing is here for decoration:

1. **GPU boot** — `pipe(from(() => requestGpuDevice()), tap(…))`. WebGPU init
   is one async step that fails when the browser has no adapter; `from`
   starts it lazily, `tap` forwards the arrival into a status atom, and the
   atom's `onError` channel covers the no-WebGPU case. The readout says
   `WebGPU: ready`, or explains what went wrong instead of drawing nothing
   quietly. `device.lost` is monitored too — driver resets get announced,
   not swallowed. (Note that `from` over a promise *completes* after its
   single emission, so completion itself must not be treated as an error —
   `endWith`-style fallbacks would fire on success as well.)
2. **Backbuffer sizing** — `pipe(resizeTicks, debounce(150), map(…),
   distinctUntilChanged(sameSize), startWith(…))`. Window resizes arrive in
   bursts; debouncing plus a comparator means the `GPUCanvasContext` is
   reconfigured once per settled size, not twice per drag-frame.
3. **Pointer** — `pipe(rawPointer, throttle(50), distinctUntilChanged(…),
   startWith(…))`. `pointermove` fires at input-device speed, far past what
   the triangle can perform; the readout shows the throttled samples.
4. **The animation** — `pipe(interval(16), filter(() => !document.hidden),
   scan(nextFrame, INITIAL_FRAME))`. A ~60 Hz heartbeat — not a clock —
   filtered so a hidden tab asks nothing, and `scan` holding the whole
   frame state: angle, tick count, and the drift offset, all advanced by
   real elapsed time (clamped, so a stalled tab rests instead of
   fast-forwarding). A subscriber hands each frame to the compositor-cadence
   present loop, which writes a 32-byte uniform buffer and submits three
   vertices.

All four are standalone `pipe(...)` chains over writable atoms. Atoms have
no `.pipe()` method; composition is a function here.

The readouts (status, angle, ticks, pointer, uptime) are all `derived` from
the pipes, bridged into the Vue template by the compiler.

## A Streamix gotcha this demo documents

The first version read the *piped* pointer atom inside the `scan`
accumulator. Pipes are hot, but their first emission is not instantaneous —
`scan`'s first tick raced the throttle's `startWith`, read a cold atom, and
poisoned the drift offset with NaN. Every draw submitted fine; the triangle
just rasterized to nothing, uniformly, forever. The fix reads the target
from `rawPointer` — a writable atom is initialized at creation, so its
value is always finite. If a pipe's `.value` is read from inside another
stream's callback, make sure the source is one that cannot be cold.

## Running

```bash
npx ng serve app9
```

Then open http://localhost:4200. Only one demo app can be served at a time.
