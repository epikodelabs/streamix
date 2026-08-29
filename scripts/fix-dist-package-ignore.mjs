import fs from 'node:fs/promises';
import path from 'node:path';

const npmIgnorePath = path.resolve('dist/streamix/.npmignore');

try {
  await fs.unlink(npmIgnorePath);
} catch (error) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  ) {
    process.exit(0);
  }

  throw error;
}
