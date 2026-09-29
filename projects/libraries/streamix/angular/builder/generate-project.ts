import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

import { compileSxComponent } from '../src/compiler/component-build-adapter.ts';
import { installSxLifecycleIntoComponentSource } from '../src/compiler/component-source-transform.ts';
import { sourceTwinOf, virtualRootOf } from './options.mjs';

const root = resolve(import.meta.dirname, '../../../../..');
const sourceRoot = process.argv[2] ?? 'projects/apps/app6/src';
const virtualRoot = virtualRootOf(sourceRoot);
const sourceDirectory = resolve(root, sourceRoot);
const outputDirectory = resolve(root, virtualRoot);
const replacements: Array<{ replace: string; with: string }> = [];

const tsconfigPath = resolve(sourceDirectory, '..', 'tsconfig.app.json');
const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(
  tsconfig.config,
  ts.sys,
  dirname(tsconfigPath),
);
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const checker = program.getTypeChecker();

// Overwrite in place rather than clearing the directory first: the delegate
// dev server rebuilds on every change, and a wiped tree would let it compile
// a half-regenerated project. Stale entries are pruned after a full pass.
await cp(sourceDirectory, outputDirectory, { recursive: true, force: true });

async function listFiles(
  directory: string,
  includeAll: boolean,
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path, includeAll));
    else if (
      includeAll ||
      (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
    ) {
      result.push(path);
    }
  }
  return result;
}

function standaloneDependencySources(sourcePath: string): string[] {
  const file = program.getSourceFile(sourcePath);
  if (!file) return [];
  const fields: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      const type = checker.getTypeAtLocation(node.initializer ?? node.name);
      if (type.getProperty('value') && type.getProperty('subscribe')) {
        fields.push(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return fields;
}

/**
 * Top-level value members of each `scope({ ... })` initializer, keyed by the
 * class field name. Nested plain-object keys are deliberately not collected:
 * `refs` only mirrors atom members, so deeper keys would resolve template
 * paths to reactive sources that do not exist.
 */
function scopeValuePathsFor(
  sourcePath: string,
): Record<string, readonly string[]> | undefined {
  const file = program.getSourceFile(sourcePath);
  if (!file) return undefined;

  const scopes: Record<string, readonly string[]> = {};

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer;
      if (
        initializer &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === 'scope' &&
        initializer.arguments.length > 0 &&
        ts.isObjectLiteralExpression(initializer.arguments[0])
      ) {
        const members = initializer.arguments[0].properties
          .filter(ts.isPropertyAssignment)
          .map(property =>
            ts.isIdentifier(property.name) ? property.name.text : undefined,
          )
          .filter((name): name is string => !!name);
        if (members.length > 0) {
          scopes[node.name.text] = members;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(file, visit);
  return Object.keys(scopes).length > 0 ? scopes : undefined;
}

/**
 * Writes via a same-directory temporary so the watching bundler always reads
 * either the previous or the new file, never a partial write.
 */
async function writeFileAtomic(path: string, contents: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, contents);
  await rename(temporary, path);
}

for (const sourcePath of await listFiles(sourceDirectory, false)) {
  const source = await readFile(sourcePath, 'utf8');
  if (!source.includes('@Component')) continue;
  const relativePath = relative(sourceDirectory, sourcePath).replace(/\\/g, '/');
  const match = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source);
  if (!match) {
    console.warn(
      `[streamix] ${relativePath}: no inline template followed by styles was found; ` +
      'copying the component through the virtual layer unchanged.',
    );
    continue;
  }
  const scopeValuePaths = scopeValuePathsFor(sourcePath);
  const compiled = compileSxComponent({
    componentPath: sourcePath,
    template: match[1],
    dependencySourcePaths: standaloneDependencySources(sourcePath),
    scopeValuePaths,
  });
  if (!compiled.generatedModule && !compiled.lifecycleInitializer) {
    if (scopeValuePaths) {
      console.warn(
        `[streamix] ${relativePath}: declares a scope but compiled no Streamix bindings; ` +
        'copying the component through the virtual layer unchanged.',
      );
    }
    continue;
  }
  const setupImportPath = compiled.generatedModule
    ? `./${relativePath.split('/').at(-1)!.replace(/\.ts$/, '.sx')}`
    : undefined;
  const lifecycle = installSxLifecycleIntoComponentSource(source, {
    setupImportPath,
    sourceReferenceFields: compiled.sourceReferenceFields,
    requiresAngularInvalidation: compiled.requiresAngularInvalidation,
  }).source;
  const outputPath = resolve(outputDirectory, relativePath);
  // Function replacer: a plain string replacement would interpret `$`
  // sequences inside the template as replacement patterns.
  const virtual = lifecycle.replace(
    match[0],
    () => `template: ${JSON.stringify(compiled.transformedTemplate)},\n  styles:`,
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFileAtomic(outputPath, virtual);
  if (compiled.generatedModule) {
    await writeFileAtomic(
      outputPath.replace(/\.ts$/, '.sx.ts'),
      `// @ts-nocheck\n${compiled.generatedModule.contents}`,
    );
  }
  replacements.push({ replace: `${sourceRoot}/${relativePath}`, with: `${virtualRoot}/${relativePath}` });
}

/**
 * Deletes virtual entries whose source twin is gone: renamed or deleted
 * sources must not linger as stale compilation inputs. Generated `.sx.ts`
 * modules are kept while their base component still exists.
 */
async function pruneStaleEntries(): Promise<void> {
  const sourceTwinPaths = new Set(
    (await listFiles(sourceDirectory, true))
      .map(path => relative(sourceDirectory, path).replace(/\\/g, '/')),
  );

  const prune = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await prune(path);
        continue;
      }
      const virtualPath = relative(outputDirectory, path).replace(/\\/g, '/');
      const baseTwin = sourceTwinOf(virtualPath);
      if (!sourceTwinPaths.has(virtualPath) && !sourceTwinPaths.has(baseTwin)) {
        await rm(path, { force: true });
      }
    }
  };

  await prune(outputDirectory);
}

await writeFile(
  resolve(outputDirectory, 'streamix-replacements.json'),
  JSON.stringify(replacements),
);

await pruneStaleEntries();
