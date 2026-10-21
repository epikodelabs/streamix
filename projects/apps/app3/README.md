# app3

`app3` is a streamix-driven Brownian motion visualization rendered with Angular.

## What it shows

- A particle swarm updated from `animationFrame` events
- Viewport resize handling through `@epikodelabs/streamix/dom`
- Collision resolution, elastic edge bouncing, drag, and random motion
- A compiled `@for` over a scope emission per frame — no change detection

## Key files

- [`src/app/app.component.ts`](./src/app/app.component.ts): particle simulation, DOM event streams, and rendering

## Run

```bash
npx ng serve app3
```

## Build

```bash
npx ng build app3 --configuration development
```
