import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import { compileSxComponent } from '../src/compiler/component-build-adapter.ts';
import { installSxLifecycleIntoComponentSource } from '../src/compiler/component-source-transform.ts';

const root = resolve(import.meta.dirname, '../../../../..');
const sourceRoot = process.argv[2] ?? 'projects/apps/app6/src';
const virtualRoot = `.angular/streamix/${sourceRoot.replace(/^projects\/apps\//, '').replace(/\/src$/, '')}/src`;
const sourceDirectory = resolve(root, sourceRoot);
const outputDirectory = resolve(root, virtualRoot);
const replacements: Array<{ replace: string; with: string }> = [];

await cp(sourceDirectory, outputDirectory, { recursive: true, force: true });

async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) result.push(path);
  }
  return result;
}

for (const sourcePath of await files(sourceDirectory)) {
  const source = await readFile(sourcePath, 'utf8');
  if (!source.includes('@Component')) continue;
  const match = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source);
  if (!match) continue;
  const relativePath = relative(sourceDirectory, sourcePath).replace(/\\/g, '/');
  const scope = /readonly\s+(\w+)\s*=\s*scope[^(]*\(\{([\s\S]*?)\}\);/.exec(source);
  const scopeValuePaths = scope ? {
    [scope[1]]: [...scope[2].matchAll(/^\s*(\w+)\s*:/gm)].map(item => item[1]),
  } : undefined;
  const compiled = compileSxComponent({ componentPath: sourcePath, template: match[1], scopeValuePaths });
  if (!compiled.generatedModule || !compiled.lifecycleInitializer) continue;
  const lifecycle = installSxLifecycleIntoComponentSource(source, {
    setupImportPath: `./${relativePath.split('/').at(-1)!.replace(/\.ts$/, '.sx')}`,
    sourceReferenceFields: compiled.sourceReferenceFields,
    requiresAngularInvalidation: compiled.requiresAngularInvalidation,
  }).source;
  const outputPath = resolve(outputDirectory, relativePath);
  const virtual = lifecycle.replace(match[0], `template: ${JSON.stringify(compiled.transformedTemplate)},\n  styles:`);
  await mkdir(dirname(outputPath), { recursive: true });
  await Promise.all([
    writeFile(outputPath, virtual),
    writeFile(outputPath.replace(/\.ts$/, '.sx.ts'), `// @ts-nocheck\n${compiled.generatedModule.contents}`),
  ]);
  replacements.push({ replace: `${sourceRoot}/${relativePath}`, with: `${virtualRoot}/${relativePath}` });
}

await writeFile(resolve(outputDirectory, 'streamix-replacements.json'), JSON.stringify(replacements));
