# Streamix Vue editor support

This Vue Language Tools plugin makes Streamix derived shorthand agree with the
compiler in Vue SFCs. In particular, raw atom reads inside a `derived` callback
are checked as their value:

```ts
const price = atom(2);
const quantity = atom(3);
const total = derived(() => price * quantity);
```

## Install

```bash
npm install @epikodelabs/streamix vue
npm install -D typescript
```

Use a Vue language-tools version compatible with the Vue extension in your
editor.

## Configure

Register the plugin in the application's `tsconfig.json` (or the tsconfig
extended by `tsconfig.app.json`):

```jsonc
{
  "vueCompilerOptions": {
    "plugins": [
      "@epikodelabs/streamix/vue/editor/tsserver"
    ]
  }
}
```

Restart the Vue language server after changing the configuration. In VS Code,
run **Developer: Reload Window** if diagnostics do not refresh.

The plugin is editor-only. The Streamix Vue compiler or Vite plugin remains
the authority for generated application code and template bindings.
