# App 1 — Stream Monitor

Real-time operator demos powered by streamix.

## What it demonstrates

| Section | Operators |
|---------|-----------|
| Live Metrics | `interval` + `scan` + `tap` |
| Search Stream | `addListener` + `map` + `debounce` + `filter` |
| Event Buffer | scope writes + manual batching |
| Combined Stream | scope-derived value, sliders via two-way bindings |
| Activity Log | `merge` + `tap` + `throttle` |
| Julia Set (Non-optimized) | `range` + `map` + `bufferCount` + `tap` + `finalize` |

## Run

```bash
ng serve app1
```

Or build for production:

```bash
ng build app1
```
