import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const testifyEntry = require.resolve('@epikodelabs/testify');
const requireFromTestify = createRequire(testifyEntry);
const playwrightCli = requireFromTestify.resolve('playwright/cli.js');

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
