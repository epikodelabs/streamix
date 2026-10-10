# App 7 — React JSX Adoption

Interactive React smoke-test application for the Streamix JSX adoption layer.

It covers the compiler-first React adoption surface, one card per scenario:

1. **Scoped profile** — a value-first scope field adapted with
   `scopeBinding(scope, key)`, which uses the raw `scope.get(key)` atom under
   the hood; text, boolean, and select JSX properties.
2. **Standalone atoms** — a standalone writable atom adapted with
   `atomBinding()` and a `derived()` projection.
3. **Scope-owned flow** — a cancellable `flow()` owned by the scope and
   consumed through the same binding bridge.
4. **Write operators** — compound (`+=`, `*=`, `**=`), update (`++`), and
   logical (`||=`, `??=`) writes on `let` atoms, plus an explicit `.value`
   read that stays reactive.
5. **Component-local ownership** — an `atom()` and a `scope()` declared inside
   a component, owned by the mounted instance and disposed with it.
6. **Aliases, maps, selection** — static aliases, atom-map properties, dynamic
   keyed reads, destructured map members that keep atom identity, and
   conditional selection between two atoms.
7. **Atom transport** — atoms and deriveds passed to capitalized components
   through typed `typeof atom` props, subscribed at the receiving boundary.

Run it with:

```bash
npx ng serve app7
```

The Streamix React builder compiles direct JSX atom reads and preserves atom
references at capitalized component boundaries. Generated hooks and
subscriptions are compiler implementation details, not application APIs.
