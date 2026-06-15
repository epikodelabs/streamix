# App 3 — Cartoon Landscape

Interactive 3D cartoon landscape built with **Three.js** and animated via **Streamix** reactive streams.

## Features

- **Three.js scene** — low-poly cartoon hills, trees, flowers, clouds, and a glowing sun
- **Weather toggle** — switch between ☀️ sunshine and 🌧️ rain
- **Streamix `onAnimationFrame`** — render loop driven by reactive animation frames
- **Streamix `atom`** — weather state as a reactive atom
- **Streamix `onResize`** — canvas resize via ResizeObserver stream
- **Streamix `fromEvent` + `throttle` + `map`** — mouse parallax camera shift
- **OrbitControls** — click and drag to orbit the camera around the scene
- **Dynamic effects** — rain particles, sun pulse, cloud drift, tree sway, flower bounce

## Scene elements

| Element | Style |
|---------|-------|
| Hills | Low-poly `MeshToonMaterial` spheres, cel-shaded |
| Trees | Cylinder trunks + stacked cone foliage |
| Flowers | Tiny colored spheres scattered across the ground |
| Clouds | Clusters of white spheres drifting slowly |
| Sun | Yellow sphere with glow halo and radiating rays |
| Rain | `THREE.Points` particle system with 2,000 droplets |

## Running

```bash
npx ng serve app3
```

Then open `http://localhost:4202` (port may vary).

## Weather modes

- **Sunshine** — bright blue sky, visible sun, flowers perked up, green grass
- **Rain** — gray sky, rain particles falling, trees sway in wind, flowers droop
