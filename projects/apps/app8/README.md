# App 8 — FIFO Workbench

An interactive React visualizer for FIFO buffering and cooperative backpressure.
It drives a push producer into a bounded buffer, showing admissions, blocked
producers, overflow policies, consumer flow, and live metrics.

The engine is the real Streamix `fromPush` source: admission, the blocked
producer queue, overflow handling, completion, and delivery all come from the
runtime, with `prefetch: false` so the asynchronous iterator pulls directly
from the single bounded buffer. The visualizer keeps a presentation mirror of
accepted values to animate the queue slot by slot, and its metrics/session
state live in Streamix `atom`/`derived` sources. Development builds therefore
expose the FIFO state and the live source in the inspector.

## What it demonstrates

1. **Bounded FIFO capacity** — tokens enter the buffer, wait in arrival order,
   and leave from the head.
2. **Cooperative backpressure** — a push resolves at admission; an automatic
   producer awaits that promise, so it pauses while the buffer is full.
3. **Overflow policies** — compare block, drop-oldest, drop-newest, and error
   behavior under burst load.
4. **Metrics** — occupancy, peak, dwell time, blocked events, drops, and
   pending admissions update while the simulation runs.
5. **Presets and guided tour** — scenario presets and an educational overlay
   explain the mechanics.

## Run

```bash
npx ng serve app8
```
