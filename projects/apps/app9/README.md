# app9

`app9` is a custom reactive wizard demo built on `@epikodelabs/streamix` scopes plus a local renderer.

## What it shows

- Nested `scope()` state for personal, address, preferences, wizard, and UI branches
- `method()` actions for navigation, submit, and tab switching
- Async scope data loading for country options
- A custom [`renderer.ts`](./src/app/renderer.ts) that binds a template string to streamix state
- Live tree/state inspection in the sidebar

## Key files

- [`src/app/app.component.ts`](./src/app/app.component.ts): app state, template, and mount logic
- [`src/app/renderer.ts`](./src/app/renderer.ts): lightweight reactive renderer used by the demo

## Run

```bash
npx ng serve app9
```

## Build

```bash
npx ng build app9 --configuration development
```
