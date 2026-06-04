# App 3 — Text Analyzer

Batch text processing with Web Worker coroutines.

## What it demonstrates

- **`compute`** — runs `analyzeText`, `countWords`, and `getTopWords` in parallel workers
- **`concatMap`** + **`fromPromise`** — sequential task pipeline
- **`catchError`** — graceful error handling in streams
- **Drag & drop** — file upload with reactive stream tracking

## Run

```bash
ng serve app3
```
