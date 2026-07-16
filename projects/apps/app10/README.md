# app10

`app10` is a streamix-driven Brownian motion visualization rendered with Angular.

## What it shows

- A particle swarm updated from `animationFrame` events
- Viewport resize handling through `@epikodelabs/streamix/dom`
- Collision resolution, elastic edge bouncing, drag, and random motion
- Manual change detection paired with a small streamix scope for lifecycle cleanup

## Key files

- [`src/app/app.component.ts`](./src/app/app.component.ts): particle simulation, DOM event streams, and rendering

## Run

```bash
npx ng serve app10
```

## Build

```bash
npx ng build app10 --configuration development
```
