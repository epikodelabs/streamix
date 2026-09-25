import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    angularCli,
    'build',
    'streamix',
    ...process.argv.slice(2),
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      // ng-packagr currently starts multiple Ora instances while building
      // secondary entry points. Running the finite package build as
      // non-interactive keeps Ora from competing for the terminal.
      CI: '1',
    },
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
