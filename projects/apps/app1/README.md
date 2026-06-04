# App 1 — Stream Monitor

Real-time operator demos powered by Streamix.

## What it demonstrates

| Section | Operators |
|---------|-----------|
| Live Metrics | `interval` + `scan` + `tap` |
| Search Stream | `fromEvent` + `map` + `debounce` + `filter` |
| Event Buffer | `createSubject` + `bufferCount` + `merge` |
| Combined Stream | `combineLatest` + `map` |
| Activity Log | `merge` + `tap` + `throttle` |
| Julia Set (Non-optimized) | `range` + `map` + `bufferCount` + `delay` + `finalize` |

## Run

```bash
ng serve app1
```

Or build for production:

```bash
ng build app1
```
