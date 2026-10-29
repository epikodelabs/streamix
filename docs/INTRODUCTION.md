<p align="center">
  <img src="https://raw.githubusercontent.com/epikodelabs/epikodelabs.github.io/refs/heads/main/streamix/LOGO.png" alt="streamix" width="380">
</p>

<p align="center">
  <strong>Reactive flows built on async iterators.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">
    <img src="https://img.shields.io/npm/v/@epikodelabs%2Fstreamix.svg?style=flat-square&color=0ea5e9">
  </a>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">
    <img src="https://img.shields.io/npm/dt/@epikodelabs%2Fstreamix.svg?style=flat-square&color=0ea5e9">
  </a>
  <a href="https://epikodelabs.github.io/streamix/bundle-size.svg">
    <img src="https://raw.githubusercontent.com/epikodelabs/streamix/refs/heads/main/projects/libraries/streamix/bundle-size.svg">
  </a>
  <a href="https://github.com/epikodelabs/streamix/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License">
  </a>
</p>


# Get started with Streamix

Configure your editor and build tools, then create your first reactive counter in Angular, React, or Vue. Start with an **existing application** and the Node.js and TypeScript versions supported by your framework.

| Framework | Requirements | Source preprocessing |
| --- | --- | --- |
| [Angular](#angular) | Angular 20+, TypeScript 5.5+ compatible with your Angular version | Angular builder |
| [React](#react) | React 18+, TypeScript 5.5+ | Vite plugin: `sx()` before `react()` |
| [Vue](#vue) | Vue 3.4+, TypeScript 5.5+ | Vite plugin: `sxVue()` before `vue()` |

Install `@epikodelabs/streamix` once; no separate compiler, builder, or editor packages are needed. Configure both the build and editor before using the examples below.

## Angular

### 1. Install

```sh
npm install @epikodelabs/streamix
npm install -D @angular/language-service
```

Keep the language-service version aligned with your Angular packages.

### 2. Configure the builder

In `angular.json`, keep your existing Angular build target as `application`, then add a Streamix `build` wrapper. The following is an **Architect target fragment**, not a replacement for the whole workspace configuration. Replace `my-app` and the paths with your project's names.

```json
{
  "application": {
    "builder": "@angular/build:application",
    "options": {
      "browser": "projects/my-app/src/main.ts",
      "tsConfig": ".angular/.streamix/my-app/tsconfig.app.json",
      "fileReplacements": [
        {
          "replace": "projects/my-app/src/main.ts",
          "with": ".angular/.streamix/my-app/src/main.ts"
        }
      ]
    }
  },
  "build": {
    "builder": "@epikodelabs/streamix/angular/builder:application",
    "options": {
      "delegateTarget": "my-app:application",
      "sourceRoot": "projects/my-app/src"
    }
  },
  "serve": {
    "builder": "@epikodelabs/streamix/angular/builder:application",
    "options": {
      "delegateTarget": "my-app:dev-server",
      "sourceRoot": "projects/my-app/src"
    }
  },
  "dev-server": {
    "builder": "@angular/build:dev-server",
    "options": {
      "buildTarget": "my-app:application"
    }
  }
}
```

Merge the `application.options` shown above into your existing Angular options, preserving `index`, assets, styles, output paths, and configurations. Move the original serve target to `dev-server` and make it delegate to `application`, so preprocessing runs once. For named development/production configurations, preserve those names on the wrappers and their delegates.

Keep editing your source files. Use `.angular/.streamix/my-app/` only as generated build output, and point the delegate at its tsconfig and entry point.

### 3. Configure the editor

Merge this into the application's TypeScript configuration:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@epikodelabs/streamix/angular/editor/tsserver"
      }
    ]
  }
}
```

Restart the TypeScript server. Use an **inline template** for the atom shorthand below. In external `templateUrl` files, use explicit `.value` reads for editor checking; scope fields are typed as values.

### 4. Add a counter

Use this standalone component in your application's component tree:

```ts
import { Component } from '@angular/core';
import { atom } from '@epikodelabs/streamix';

@Component({
  selector: 'app-counter',
  standalone: true,
  template: '<button (click)="increment()">{{ count }}</button>',
})
export class CounterComponent {
  readonly count = atom(0);

  increment(): void {
    this.count.set(this.count.value + 1);
  }
}
```

For Zone.js applications, add `provideSxZoneScheduling()` from `@epikodelabs/streamix/angular` to your existing application providers. Zoneless applications need no provider.

```sh
npx ng serve my-app
npx ng build my-app
```

Clicking the button should increment the displayed value. [Continue with Angular](./ANGULAR.md) for scopes, two-way bindings, compiler boundaries, and SSR.

## React

### 1. Install

In an existing React/Vite application:

```sh
npm install @epikodelabs/streamix
npm install -D typescript vite @vitejs/plugin-react
```

Install TypeScript even in JavaScript-only projects.

### 2. Configure Vite

Preprocess sources with `sx()` **before** the React plugin in `vite.config.ts`. Use this configuration for both the development server and production builds. Keep your other application settings.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sx } from '@epikodelabs/streamix/react/vite';

export default defineConfig({
  plugins: [sx(), react()],
});
```

### 3. Configure the editor

Add this to the tsconfig that includes your React source files, such as `tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@epikodelabs/streamix/react/editor/tsserver"
      }
    ]
  }
}
```

Restart the TypeScript server after saving the configuration.

### 4. Add a counter

Render this component from your existing application root:

```tsx
import { atom } from '@epikodelabs/streamix';

export function Counter() {
  let count = atom(0);
  return <button onClick={() => count++}>{count}</button>;
}
```

Declare local reactive state directly in the component body, before conditional returns.

```sh
npx vite
npx vite build
```

Clicking the button should increment the displayed value. [Continue with React](./REACT.md) for scopes, component props, explicit runtime APIs, and SSR.

## Vue

### 1. Install

In an existing Vue/Vite application:

```sh
npm install @epikodelabs/streamix
npm install -D typescript vite @vitejs/plugin-vue
```

### 2. Configure Vite

Preprocess Vue SFCs with `sxVue()` **before** Vue's SFC plugin in `vite.config.ts`. Use this configuration for both the development server and production builds:

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { sxVue } from '@epikodelabs/streamix/vue/vite';

export default defineConfig({
  plugins: [sxVue(), vue()],
});
```

### 3. Configure the editor

Add the Vue Language Tools plugin to the application's tsconfig, or the config extended by `tsconfig.app.json`:

```json
{
  "vueCompilerOptions": {
    "plugins": [
      "@epikodelabs/streamix/vue/editor/tsserver"
    ]
  }
}
```

Register this under `vueCompilerOptions.plugins`, not `compilerOptions.plugins`. Restart the Vue language server; in VS Code, reload the window if diagnostics do not refresh.

### 4. Add a counter

Mount this component from your existing application:

```vue
<script setup lang="ts">
import { atom } from '@epikodelabs/streamix';

const count = atom(0);
</script>

<template>
  <button @click="count++">{{ count }}</button>
</template>
```

Declare the atom in `<script setup>` and use `count` directly in the template, as shown above.

```sh
npx vite
npx vite build
```

Clicking the button should increment the displayed value. [Continue with Vue](./VUE.md) for scopes, `v-model`, explicit bridges, and SSR.

## Enable introspection

Set `introspection` to `true` to inspect reactive state while developing. Use the browser panel to check current values, dependencies, subscriptions, flow activity, and cleanup. Source names, file locations, and scope ownership help you find the corresponding code.

The option is a boolean and defaults to `false`. Configure it on the Angular builder or the React/Vue Vite plugin.

### Angular

In `angular.json`, merge these configurations into **both** the `build` and `serve` wrapper targets configured above. Keep their existing `builder`, `delegateTarget`, `sourceRoot`, and other configuration settings.

```json
{
  "configurations": {
    "development": { "introspection": true },
    "production": { "introspection": false }
  }
}
```

Start the application with the development configuration:

```sh
npx ng serve my-app --configuration development
```

For a diagnostic build, use `npx ng build my-app --configuration development`. Use `--configuration production` for a build without introspection.

### React

Enable introspection for the development server in `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sx } from '@epikodelabs/streamix/react/vite';

export default defineConfig(({ command }) => ({
  plugins: [sx({ introspection: command === 'serve' }), react()],
}));
```

### Vue

Use the same setting on `sxVue()` in `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { sxVue } from '@epikodelabs/streamix/vue/vite';

export default defineConfig(({ command }) => ({
  plugins: [sxVue({ introspection: command === 'serve' }), vue()],
}));
```

Run `npx vite`, open the application, and expand the inspector in the bottom-right corner. With these Vite configurations, `npx vite build` leaves introspection disabled.

### Open the inspector

With a standard entry file, the panel mounts automatically; no additional component is required. Angular uses `main.ts` directly under `sourceRoot`. React recognizes `main` or `index` with a `.ts`, `.tsx`, `.js`, or `.jsx` extension; Vue recognizes `main.ts`, `main.js`, `index.ts`, or `index.js`. Keep the entry included if you configure a plugin's `include` filter.

If you use a custom entry file, add activation there explicitly:

```ts
import {
  enableStreamixIntrospection,
  mountStreamixInspector,
} from '@epikodelabs/streamix/introspection';

// Before bootstrapping the application:
enableStreamixIntrospection();

// After bootstrapping, when document.body exists:
mountStreamixInspector();
```

Keep `introspection: true` on the builder/plugin for source metadata and diagnostic activation with a custom entry too.

Keep the option disabled for production. Setting it to `true` explicitly forces `import.meta.env.DEV` to `true`, even during a production build; it is not automatically restricted to the development server.

## Plain TypeScript

Without a framework compiler, use explicit tracked reads inside `derived`:

```ts
import { atom, derived } from '@epikodelabs/streamix';

const count = atom(0);
const doubled = derived(self => self(count) * 2);

count.set(3);
console.log(doubled.value); // 6
```

Direct expressions such as `derived(() => count * 2)` in the framework guides require their Streamix compiler. Outside compiled expressions, use `.value` for an explicit current-value read.

## If something does not work

- **The UI shows an atom object:** check that the Streamix builder is active, or that the Streamix Vite plugin runs before the framework plugin.
- **The editor flags supported shorthand:** check the application's active tsconfig, install the matching language tooling, and restart the relevant language server.
- **The editor accepts code that the build rejects:** follow the build diagnostic.
- **An Architect builder cannot be resolved:** install a package release containing that builder, or build the Streamix package first when working from source.

## Next steps

- [Atoms and scopes](./ATOMS.md): writable state, derived values, lifecycle ownership, and flows.
- [Generators](./GENERATORS.md): create and consume async sequences.
- [DOM and browser streams](./DOM.md): pointer, scroll, and location updates.
- [Migration](./MIGRATION.md): move existing code to the current API.

## API Reference

Browse the [API reference](./api/) for the complete runtime and operator catalog.

## Resources

- [npm](https://www.npmjs.com/package/@epikodelabs/streamix)
- [GitHub](https://github.com/epikodelabs/streamix)
- [Discord community](https://discord.gg/XSC9qFn2R)
- [Give feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)

## License

MIT
