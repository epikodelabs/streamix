/**
 * The dom package intentionally exposes one public entry point: the `on`
 * dispatcher (see `./on`). The individual factory modules are implementation
 * details of that dispatcher and are deliberately not re-exported, so the
 * public API surface stays `import { on } from '@epikodelabs/streamix/dom'`.
 */
export * from './on';
