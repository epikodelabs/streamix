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

It is a secondary entry point of the library, built by ng-packagr alongside
the runtime and the compiler:

- Sources live in `angular/builder/src/`. `angular/builder/ng-package.json`
  only marks the entry point, exactly like `angular/compiler/` does for the
  compiler.
- ng-packagr emits `dist/streamix/fesm2022/epikodelabs-streamix-angular-builder.mjs`
  plus types, and copies `builders.json`, `schema.json`, this README and
  `application.mjs` into `dist/streamix/angular/builder/`.
- `application.mjs` is a one-line shim: architect requires the implementation
  file to live inside the subpackage (it rejects paths that escape it), so the
  shim re-exports the compiled entry from the package's `fesm2022` folder.
- `scripts/finalize-dist.mjs` runs after the build. ng-packagr cannot know it
  produced a builder, so that step adds the builder subpackage to the package
  `exports` map, points the subpackage manifest at `./builders.json`, and links
  the built package into `node_modules` so in-repo applications resolve it.
- `angular.json` references the same name a consumer would:
  `"builder": "@epikodelabs/streamix/angular/builder:application"`.

Runtime dependencies are resolved from the consuming workspace, which has them
through the Angular CLI: `@angular-devkit/architect`, `@angular/compiler` and
`typescript`. They are declared as optional peers on the main package. Node
`>=20.11` is required.

The builder runs the generator in process — no child process, no `ts-node`
registration: the compiled entry imports `generateProject` directly.

