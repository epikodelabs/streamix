/**
 * Entry activation injected by every framework toolchain (Angular, React, and
 * Vue builders; the React Vite plugin) for introspection builds. One shape,
 * one place: activation runs before application code so flows register before
 * the inspector observes them, and the panel mounts after the entry module
 * evaluates. The gate stays `import.meta.env.DEV` inside the imported
 * functions, so production bundles carry inert definitions.
 */
export function injectIntrospectionActivation(code: string): string {
  return `import { enableStreamixIntrospection as __sxEnable, mountStreamixInspector as __sxMount } from '@epikodelabs/streamix';\n__sxEnable();\n${code}\n__sxMount();\n`;
}
