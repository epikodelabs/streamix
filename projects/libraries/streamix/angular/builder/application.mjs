// Architect requires a builder implementation inside the subpackage (it
// rejects paths that escape the directory), so this shim re-exports the
// compiled entry point from the package's fesm2022 folder. The default export
// is built here because ng-packagr's FESM keeps named exports only.
export * from '../../fesm2022/epikodelabs-streamix-angular-builder.mjs';
import { applicationBuilder } from '../../fesm2022/epikodelabs-streamix-angular-builder.mjs';
export default applicationBuilder;
