import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const npmIgnorePath = path.resolve('dist/streamix/.npmignore');
const packagePath = path.resolve('dist/streamix/package.json');

try {
  await fs.unlink(npmIgnorePath);
} catch (error) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  ) {
    // Nothing to remove; continue with the manifest fixup below.
  } else {
    throw error;
  }
}

/**
 * ng-packagr writes the `exports` map from its own entry-point list, which
 * does not include the `package.json` of a subpackage. The Angular CLI
 * resolves `<package>/<subpath>/package.json` to read a builder's `builders`
 * field, so the builder entry needs that subpath exposed.
 */
const manifest = JSON.parse(await fs.readFile(packagePath, 'utf8'));
const builderManifest = './angular/builder/package.json';

if (manifest.exports && !manifest.exports[builderManifest]) {
  manifest.exports[builderManifest] = builderManifest;
  await fs.writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * The builder subpackage's generated manifest only carries `module` and
 * `typings`, because ng-packagr does not know it is also an architect
 * builder. Point it at the copied `builders.json`.
 */
const builderPackagePath = path.resolve(
  'dist/streamix/angular/builder/package.json',
);

try {
  const builderPackage = JSON.parse(
    await fs.readFile(builderPackagePath, 'utf8'),
  );

  if (builderPackage.builders !== './builders.json') {
    builderPackage.builders = './builders.json';
    await fs.writeFile(
      builderPackagePath,
      `${JSON.stringify(builderPackage, null, 2)}\n`,
    );
  }
} catch (error) {
  if (
    !(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
  ) {
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Link the built package into node_modules.
//
// Applications in this workspace — and the builder subpackage, which imports
// the compiler through the package's own subpath — resolve the package from
// node_modules, where npm places the published release. Linking dist there
// keeps `ng serve app6` running against local sources; `npm install` restores
// the published copy.
// ---------------------------------------------------------------------------

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { lstat, realpath, rm, symlink } = fs;
const built = path.join(root, 'dist', 'streamix');
const installed = path.join(root, 'node_modules', '@epikodelabs', 'streamix');

export async function linkLocalPackage() {
  if (!existsSync(path.join(built, 'package.json'))) {
    console.log('dist/streamix is not built; keeping the installed package.');
    return;
  }

  let current;

  try {
    current = await lstat(installed);
  } catch {
    current = undefined;
  }

  if (current?.isSymbolicLink()) {
    if ((await realpath(installed)) === (await realpath(built))) {
      return;
    }

    await rm(installed, { force: true });
  } else if (current) {
    await rm(installed, { recursive: true, force: true });
  }

  await symlink(
    built,
    installed,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  console.log('Linked node_modules/@epikodelabs/streamix to dist/streamix.');
}

await linkLocalPackage();
