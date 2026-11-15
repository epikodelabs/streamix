import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

// Testify resolves its source/test directories against process.cwd() and
// compares them with Windows paths using case-sensitive strings. When the
// shell starts in `c:\...` rather than `C:\...`, the comparison misses and the
// test bundle falls back to the first source/test root. That emits two module
// graphs for the same files, so the reactive core is loaded twice and the
// introspection suites observe the wrong instance. Canonicalize the working
// directory for the child process so the paths share one casing.
let cwd = process.cwd();
try {
  cwd = realpathSync.native(cwd);
} catch {
  // Keep the original path if the platform cannot canonicalize it.
}

const bin = resolve(cwd, 'node_modules/@epikodelabs/testify/bin/testify');
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], {
  cwd,
  stdio: 'inherit',
  env: process.env,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', error => {
  console.error(error);
  process.exitCode = 1;
});
child.on('close', code => {
  process.exitCode = code ?? 1;
});
