# @epikodelabs/streamix-angular-builder

Angular architect builder that compiles an application's components through
the Streamix virtual layer before delegating to the regular Angular
application build or dev server.

## How it works

`app6` in the workspace `angular.json` shows the wiring:

1. `application.mjs` runs `generate-project.ts <sourceRoot>`, which copies the
   source tree into `.angular/streamix/<app>/src`, compiles every component
   with an inline `template` through the Streamix compiler, and writes the
   transformed component plus a generated `*.sx.ts` setup module back into
   the virtual tree.
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

## Runtime requirements

The package is consumed inside this workspace as a `file:` dependency (a
symlink), so npm does **not** install its dependencies. It resolves, from
the workspace root at runtime:

- `@angular-devkit/architect` (builder host API)
- `typescript` (the generator's TypeScript program)
- `ts-node` (ESM registration for executing the TypeScript generator via
  `--import` + `register("ts-node/esm/transpile-only")`)

Node `>=20.11` is required (`import.meta.dirname` in the generator).

## Publishing checklist (when this becomes a real package)

This is currently an in-repo tool (`"private": true`). Before publishing:

1. Remove `private` and add a `version`.
2. Declare runtime dependencies (`@angular-devkit/architect`, `typescript`,
   `ts-node`) or peer dependencies — they resolve from the workspace root
   today only because of the `file:` symlink.
3. Precompile `generate-project.ts` (and its `../src/compiler` imports) to a
   bundled `.mjs` so consumers do not need `ts-node`, and drop the
   `--import` registration from `application.mjs`.
4. Reconsider the `projects/apps/app6/src` default for `sourceRoot`.
