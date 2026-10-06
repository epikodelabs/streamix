// Builds the Angular builder into `dist/streamix/builder`, the subpackage the
// published tarball ships and `angular.json` references as
// `@epikodelabs/streamix/builder:application`.
//
// The in-repo tool runs `generate-project.ts` through ts-node and resolves its
// dependencies from the workspace root through a `file:` symlink. The shipped
// copy contains a bundled generator instead, so a consuming workspace needs no
// ts-node registration.
import { build } from 'esbuild';
import {
  cp, lstat, mkdir, readFile, realpath, rm, symlink, unlink, writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const builderDirectory = path.join(
  root,
  'projects',
  'libraries',
  'streamix',
  'angular',
  'builder',
);

const outputDirectory = path.join(root, 'dist', 'streamix', 'builder');

/** Metadata files copied verbatim into the artifact. */
const ASSETS = [
  'application.mjs',
  'options.mjs',
  'builders.json',
  'schema.json',
  'README.md',
];

export async function buildBuilder() {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  // The generator compiles the consuming application with the TypeScript
  // checker and the Angular compiler. Both stay external so the artifact uses
  // the versions the consumer already builds with instead of shipping its own.
  await build({
    entryPoints: [path.join(builderDirectory, 'generate-project.ts')],
    outfile: path.join(outputDirectory, 'generate-project.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['typescript', '@angular/compiler', '@angular-devkit/*'],
  });

  for (const asset of ASSETS) {
    await cp(
      path.join(builderDirectory, asset),
      path.join(outputDirectory, asset),
    );
  }

  // Secondary-entry package metadata, like ng-packagr emits for the runtime
  // entry points. It exposes the builder to the Angular CLI; the dependencies
  // it needs at build time are declared as optional peers on the main package.
  await writeFile(
    path.join(outputDirectory, 'package.json'),
    `${JSON.stringify(
      {
        type: 'module',
        builders: 'builders.json',
        engines: { node: '>=20.11' },
      },
      null,
      2,
    )}\n`,
  );

  await ensureBuilderExport(
    path.join(root, 'dist', 'streamix', 'package.json'),
  );
  await linkIntoWorkspace();

  console.log(`Built ${path.relative(root, outputDirectory)}.`);
}

/**
 * ng-packagr writes the package `exports` map without knowledge of this
 * subpackage, so the CLI cannot resolve `@epikodelabs/streamix/builder`. Add
 * the entry (idempotently) to the built manifest and to the installed copy the
 * workspace resolves.
 */
async function ensureBuilderExport(manifestPath) {
  if (!existsSync(manifestPath)) {
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (!manifest.exports || manifest.exports['./builder/package.json']) {
    return;
  }

  manifest.exports['./builder/package.json'] = './builder/package.json';
  manifest.exports['./builder/*'] = './builder/*';

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * The Angular CLI resolves builders through Node, so building app6 in this
 * repository needs `@epikodelabs/streamix/builder` to exist inside the
 * installed package. Link the freshly built subpackage there; a published
 * consumer gets it from the tarball instead.
 */
async function linkIntoWorkspace() {
  const installed = path.join(root, 'node_modules', '@epikodelabs', 'streamix');

  if (!existsSync(installed)) {
    return;
  }

  // The installed manifest needs the same export entry, otherwise the CLI
  // cannot resolve the builder subpath from node_modules. Do this before the
  // link check below, which returns early when the link is already correct.
  await ensureBuilderExport(path.join(installed, 'package.json'));

  const link = path.join(installed, 'builder');

  let current;

  try {
    current = await lstat(link);
  } catch {
    current = undefined;
  }

  if (current?.isSymbolicLink()) {
    if ((await realpath(link)) === (await realpath(outputDirectory))) {
      return;
    }

    await unlink(link);
  } else if (current) {
    await rm(link, { recursive: true, force: true });
  }

  await symlink(
    outputDirectory,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await buildBuilder();
}
