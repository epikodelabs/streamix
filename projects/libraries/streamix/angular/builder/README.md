# @epikodelabs/streamix/builder

Angular architect builder that compiles an application's components through
the Streamix virtual layer before delegating to the regular Angular
application build or dev server.

## How it works

`app6` in the workspace `angular.json` shows the wiring:

1. `application.mjs` runs the generator (`generate-project.ts` from source in
   this repository, the bundled `generate-project.mjs` in the shipped
   subpackage), which copies the source tree into
   `.angular/streamix/<app>/src`, compiles every component with an inline
   `template` through the Streamix compiler, and writes the transformed
   component — with the compiled setup inlined — back into the virtual tree.
2. The builder then schedules the `delegateTarget` (e.g. `app6:application`
   or `app6:dev-server`). The delegate's `fileReplacements` entry points
   `main.ts` at the virtual copy, so the whole application compiles from the
   virtual tree.
3. While the delegate runs, the builder watches the source root
   (recursively) and re-runs the generator on save; the delegate rebuilds on
   its own once the virtual files are rewritten.

## Options

- `delegateTarget` (required): `"project:target"` pair that receives the
  generated component.
- `sourceRoot`: application source directory, relative to the workspace
  root. Defaults to the in-repo `projects/apps/app6/src` demo; consuming
  workspaces should always pass their own.

All other options are forwarded to the delegate target. Keys that only this
builder understands, plus empty placeholder values materialized by CLI
schema validation, are dropped before forwarding (see `options.mjs`, which
also holds the pure helpers covered by `builder-options.spec.ts`).

## Distribution

The builder ships inside the `@epikodelabs/streamix` package as the `builder/`
subpackage:

- `scripts/build-builder.mjs` bundles `generate-project.ts` (with the compiler
  it imports) into `dist/streamix/builder/generate-project.mjs` and copies
  `application.mjs`, `options.mjs`, `builders.json`, `schema.json` and this
  README next to it. It runs as the second step of `npm run build` /
  `npm run build:packages`, after ng-packagr has produced the rest of the
  package.
- The subpackage carries its own `package.json` with the `builders` entry, and
  the build adds `./builder/*` to the package `exports` map (ng-packagr cannot
  know about it).
- The workspace's own `angular.json` therefore references the same name a
  consumer would: `"builder": "@epikodelabs/streamix/builder:application"`.
  For a local build to resolve it, the build links `builder/` into the
  installed `node_modules/@epikodelabs/streamix`.

Runtime dependencies are resolved from the consuming workspace, which has them
through the Angular CLI: `@angular-devkit/architect`, `@angular/compiler` and
`typescript`. They are declared as optional peers on the main package. Node
`>=20.11` is required.

The shipped generator runs as plain Node ESM — no `ts-node` registration. In
this repository the builder still runs the TypeScript source through
`ts-node`, which `application.mjs` detects by looking for the bundled
`generate-project.mjs` next to itself.

