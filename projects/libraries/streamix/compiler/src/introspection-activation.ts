/**
 * Inject a first-import side effect, not an enable() statement in the entry
 * body: ES module dependencies evaluate before the entry's body executes.
 * The activation subentry enables diagnostics before application imports run.
 */
const activationImport = "import '@epikodelabs/streamix/introspection/activate';";

export function injectIntrospectionActivation(code: string): string {
  if (code.includes(activationImport)) return code;
  return `${activationImport}\nimport { mountStreamixInspector as __sxMount } from '@epikodelabs/streamix/introspection';\n${code}\n__sxMount();\n`;
}
