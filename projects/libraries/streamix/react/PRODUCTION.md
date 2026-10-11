# Streamix React production release gates

This document accompanies a corrective source batch. **Do not label the package
production-verified solely because the compiler's isolated tests pass.**

## Addressed in this batch

- Class component implicit JSX adoption fails as a build **error**, detected from
  JSX syntax rather than matching string/comment text.
- Anonymous default-exported function components receive the same hook adoption
  as named components; both module and render-local atoms are covered.
- Named `memo`/`forwardRef` aliases and `React.memo` / `React.forwardRef` are
  recognized only when actually imported from React. Unknown wrappers carrying
  implicit reactive JSX fail instead of shipping atom objects as children.
- In Program-backed compiler mode, imported factory aliases cannot adopt local
  shadowing declarations. The TS server virtualizer uses a conservative lexical
  shadowing guard for the same case.
- Browser ESM without `process` no longer crashes when importing DevTools;
  diagnostics are disabled unless a development environment is established.
- Vite's invalidated TS programs are not retained in a second unbounded map.

## Dependency contract

The enclosing `@epikodelabs/streamix` package declares `typescript >=5.5.0`
with `peerDependenciesMeta.typescript.optional=true`. Retain this optional peer
for users of the core runtime. **Apps importing the React compiler, builder, or
Vite entry point must install TypeScript explicitly** (including JSX-only apps).
The root package manifest was not part of the latest React-only source bundle;
verify the published manifest still has that peer declaration before release.

## Required project-level verification before publishing stable

| Gate | Pass criterion | Status from this artifact-only environment |
|---|---|---|
| Compiler regressions | Existing and new specs all pass | Isolated TypeScript harness passed |
| Compiler typecheck | Strict TS/noEmit | Passed |
| Editor typecheck/runtime | Shadowed import cases, diagnostics/hover offsets | Shadow-case smoke passed; full LS suite unverified |
| Native React build | Vite builds TS/TSX/JS/JSX examples, no missing peers | Not run (Vite unavailable) |
| Concurrent rendering | Real React Strict Mode, interrupted Suspense, hydration | Not run (React unavailable) |
| Activity | Hidden/revealed tree retains atoms under explicit lifetime | Not run (React unavailable) |
| React Compiler | Build an adopted component through React Compiler | Not run (React Compiler unavailable) |
| Fast Refresh | Add/remove reactive read and edit local initializer across HMR | Not run (React/Vite unavailable) |
| Source maps | Trace both original source and runtime exceptions through composed esbuild/Vite maps | Not run (bundler unavailable) |
| Angular delegate | Architect build and incremental `serve` source regeneration | Not run (Angular builder unavailable) |
| Production DevTools | No `process` global, no reference error or event tracing | Isolated VM smoke recommended |
| Published package | `npm pack` and install tarball in clean TSX and JSX Vite apps | Not run (root manifest/build unavailable) |

Use the repository's configured Testify/browser suite for the existing specs in
`react/compiler/src`, `react/src/tests`, `react/vite/src`,
`react/builder/src`, and `react/editor/src`. Do not skip React 19 Activity tests
by running only a React version that lacks that API. Verify in development and
minified production builds; tests that require browser or published outputs must
run against actual dependency versions.

### Known semantic constraints

Implicit adoption is not promised for arbitrary `dynamic import`, arbitrary
proxy fields, opaque higher-order components, class components, or React Activity
without a parent-owned `StreamixLifetime`. Rendering unknown reactive values
without a proven subscription must fail with a diagnostic or remain explicit
through `useAtomValue`, `read`, `write`, and `atomRef`.

`useResource(loader, dependencies)` recreates its resource only when the caller's
`dependencies` change. The loader callback alone is not an invalidation key.
This is an explicit dependency contract, not an automatic dependency collector.
