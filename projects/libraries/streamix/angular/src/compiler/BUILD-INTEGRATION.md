# sx build integration

The build contract is now split into three layers:

```text
component template
      ↓
compileSxComponent()
      ↓
┌────────────────────────────┬──────────────────────────────┐
│ transformed Angular HTML   │ generated *.sx.ts module    │
│                            │                              │
│ sx bindings removed        │ createBindingTable(N)        │
│ data-sx node markers       │ ɵsx* direct instructions     │
└────────────────────────────┴──────────────────────────────┘
                 ↓
component source lifecycle insertion
                 ↓
ɵinstallSxCompiledView(this, ɵsetupSxBindings)
                 ↓
afterNextRender()
                 ↓
setup runs and returns a teardown handle
(the binding table, or a `{ destroy() {} }`
object for structural blocks)
                 ↓
DestroyRef.onDestroy()
                 ↓
teardown handle destroyed
```

`ɵinstallSxCompiledView` uses public Angular APIs only: `ElementRef`,
`afterNextRender`, and `DestroyRef`.

The compiler package exposes:

- `compileSxComponent()` — deterministic per-component build payload;
- `installSxLifecycleIntoComponentSource()` — conservative source bridge;
- `emitComponentModule()` — generated direct-binding module;
- `transformAngularComponentTemplate()` — low-level template transform.

The source bridge intentionally supports only conventional exported component
classes and fails loudly for other source shapes. It is not presented as a
general Angular CLI plugin.

## Next performance step

`data-sx` plus `querySelector()` exists only during setup. The next compiler
stage should eliminate this bridge by using generated direct node references.
That will leave:

```text
source emission
→ integer slot dirty
→ one table/frame flush
→ exact DOM write
```

with no lookup in setup or update paths.
