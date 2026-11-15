# App 8 — FIFO Workbench

An interactive React visualizer for FIFO buffering and cooperative backpressure.
It simulates a push producer feeding a bounded buffer, showing admissions,
blocked producers, overflow policies, consumer flow, and live metrics.

The visualizer simulates its FIFO engine locally; it is a standalone
educational app rather than a binding to a particular runtime. Introspection
activation is still supported when the app is built in development mode.

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
