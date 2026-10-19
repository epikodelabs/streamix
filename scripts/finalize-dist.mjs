import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
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
const reactBuilderManifest = './react/builder/package.json';
const vueBuilderManifest = './vue/builder/package.json';

if (manifest.exports && !manifest.exports[builderManifest]) {
  manifest.exports[builderManifest] = builderManifest;
  await fs.writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
}
if (manifest.exports && !manifest.exports[reactBuilderManifest]) {
  manifest.exports[reactBuilderManifest] = reactBuilderManifest;
  await fs.writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
}
if (manifest.exports && !manifest.exports[vueBuilderManifest]) {
  manifest.exports[vueBuilderManifest] = vueBuilderManifest;
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
const reactBuilderPackagePath = path.resolve(
  'dist/streamix/react/builder/package.json',
);
const vueBuilderPackagePath = path.resolve(
  'dist/streamix/vue/builder/package.json',
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

try {
  const builderPackage = JSON.parse(await fs.readFile(reactBuilderPackagePath, 'utf8'));
  if (builderPackage.builders !== './builders.json') {
    builderPackage.builders = './builders.json';
    await fs.writeFile(reactBuilderPackagePath, `${JSON.stringify(builderPackage, null, 2)}\n`);
  }
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
}

try {
  const builderPackage = JSON.parse(await fs.readFile(vueBuilderPackagePath, 'utf8'));
  if (builderPackage.builders !== './builders.json') {
    builderPackage.builders = './builders.json';
    await fs.writeFile(vueBuilderPackagePath, `${JSON.stringify(builderPackage, null, 2)}\n`);
  }
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
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

// ---------------------------------------------------------------------------
// Infrastructure bundles ship without source maps. The builder, compilers,
// editors, and vite plugins run in Node at build time, where nothing consumes
// a source map by default — publishing them only bloats the tarball. Runtime
// bundles keep theirs: those are what consumers debug in devtools.
// ---------------------------------------------------------------------------

const infrastructureEntries = [
  'angular-compiler',
  'angular-builder',
  'angular-editor',
  'react-compiler',
  'react-builder',
  'react-editor',
  'react-vite',
  'vue-compiler',
  'vue-builder',
  'vue-editor',
  'vue-vite',
];

export async function stripInfrastructureSourceMaps() {
  let strippedBytes = 0;
  for (const entry of infrastructureEntries) {
    const mapPath = path.join('dist/streamix/fesm2022', `epikodelabs-streamix-${entry}.mjs.map`);
    const bundlePath = path.join('dist/streamix/fesm2022', `epikodelabs-streamix-${entry}.mjs`);
    try {
      strippedBytes += (await fs.stat(mapPath)).size;
      await fs.unlink(mapPath);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    // Drop the trailer that points at the removed map; a dangling
    // sourceMappingURL makes devtools log a missing-map warning.
    try {
      const source = await fs.readFile(bundlePath, 'utf8');
      const cleaned = source.replace(/\n?\/\/# sourceMappingURL=.*$/g, '');
      if (cleaned !== source) {
        strippedBytes += source.length - cleaned.length;
        await fs.writeFile(bundlePath, cleaned);
      }
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  if (strippedBytes > 0) {
    console.log(`Stripped infrastructure source maps (${(strippedBytes / 1024).toFixed(0)} KB).`);
  }
}

await stripInfrastructureSourceMaps();

await linkLocalPackage();
