import { createRequire, syncBuiltinESMExports } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const angularCli = path.join(
  root,
  'node_modules',
  '@angular',
  'cli',
  'bin',
  'ng.js',
);

if (!existsSync(angularCli)) {
  console.error(
    'Angular CLI is not installed. Run npm install before building Streamix.',
  );
  process.exitCode = 1;
} else {
  // ng-packagr 22 schedules independent entry points concurrently using:
  //
  //   Math.max(1, Math.min(availableParallelism() - 1, 8))
  //
  // Streamix has several secondary entry points. Concurrent ng-packagr
  // transforms each create their own Ora spinner, which causes terminal
  // corruption warnings. Restrict the build process to one available worker
  // so ng-packagr schedules entry points sequentially.
  const require = createRequire(import.meta.url);
  const os = require('node:os');

  Object.defineProperty(os, 'availableParallelism', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: () => 1,
  });

  // Keep `import { availableParallelism } from 'node:os'` in sync with the
  // CommonJS built-in module object patched above.
  syncBuiltinESMExports();

  const extraArgs = process.argv.slice(2);

  process.argv = [
    process.execPath,
    angularCli,
    'build',
    'streamix',
    ...extraArgs,
  ];

  await import(pathToFileURL(angularCli).href);
}
