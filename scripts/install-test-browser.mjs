import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const testifyEntry = require.resolve('@epikodelabs/testify');
const requireFromTestify = createRequire(testifyEntry);

// Playwright does not export "./cli.js", but it does export "./package.json".
// Resolve the package from Testify's dependency context, then use Playwright's
// declared bin entry as a filesystem path. This works whether npm hoists
// Playwright to the workspace root or nests it under Testify.
const playwrightPackagePath =
  requireFromTestify.resolve('playwright/package.json');

const playwrightPackage = JSON.parse(
  readFileSync(playwrightPackagePath, 'utf8'),
);

const playwrightBin =
  typeof playwrightPackage.bin === 'string'
    ? playwrightPackage.bin
    : playwrightPackage.bin?.playwright;

if (!playwrightBin) {
  throw new Error(
    'Unable to locate the Playwright CLI from playwright/package.json',
  );
}

const playwrightCli = path.resolve(
  path.dirname(playwrightPackagePath),
  playwrightBin,
);

const browsers =
  process.argv.length > 2
    ? process.argv.slice(2)
    : ['chromium'];

const child = spawn(
  process.execPath,
  [
    playwrightCli,
    'install',
    '--with-deps',
    ...browsers,
  ],
  {
    stdio: 'inherit',
  },
);

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
