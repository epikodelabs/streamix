# App 7 — React JSX Adoption

Interactive React smoke-test application for the Streamix JSX adoption layer.

It covers the compiler-first React adoption surface:

- a standalone atom adapted with `atomBinding()`;
- a value-first scope field adapted with `scopeBinding(scope, key)`, which uses
  the raw `scope.get(key)` atom under the hood.
- text, boolean, and select JSX properties;
- a standalone writable counter atom;
- a cancellable `flow()` owned by the scope and consumed through the same
  binding bridge.

Run it with:

```bash
npx ng serve app7
```

The Streamix React builder compiles direct JSX atom reads and preserves atom
references at capitalized component boundaries. Generated hooks and
subscriptions are compiler implementation details, not application APIs.
