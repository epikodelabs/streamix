/**
 * Streamix Angular builder entry point.
 *
 * `builders.json` points the `application` builder at this module's default
 * export; the named exports are the pieces a workspace can reuse directly.
 */
export { applicationBuilder, default } from './application';
export { generateProject, type SxGenerateProjectOptions } from './generate-project';
export {
  DEFAULT_SOURCE_ROOT,
  buildDelegateOptions,
  resolveSourceRoot,
  shouldRegenerateOn,
  templateLiteral,
  virtualRootOf,
  type SxBuilderOptions,
} from './options';
