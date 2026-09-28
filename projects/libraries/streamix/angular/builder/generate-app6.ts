import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { compileSxComponent } from '../src/compiler/component-build-adapter.ts';
import { installSxLifecycleIntoComponentSource } from '../src/compiler/component-source-transform.ts';

const root = resolve(import.meta.dirname, '../../../../..');
const sourcePath = resolve(root, 'projects/apps/app6/src/app/app.component.ts');
const outputPath = resolve(root, '.angular/streamix/app6/app.component.ts');
const setupPath = resolve(root, '.angular/streamix/app6/app.component.sx.ts');
const source = await readFile(sourcePath, 'utf8');
const templateMatch = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source);
if (!templateMatch) throw new Error('App6 must use an inline template.');

const compiled = compileSxComponent({
  componentPath: sourcePath,
  template: templateMatch[1],
  scopeValuePaths: {
    model: [
      'pageTransform', 'isPartyTime', 'count', 'redWidth', 'orangeWidth',
      'yellowWidth', 'greenWidth', 'blueWidth', 'message', 'celebration',
    ],
  },
});
if (!compiled.generatedModule || !compiled.lifecycleInitializer) {
  throw new Error('App6 did not produce Streamix compiler output.');
}

const lifecycleSource = installSxLifecycleIntoComponentSource(source, {
  setupImportPath: './app.component.sx',
  sourceReferenceFields: compiled.sourceReferenceFields,
  requiresAngularInvalidation: compiled.requiresAngularInvalidation,
}).source;
const virtualSource = lifecycleSource.replace(
  templateMatch[0],
  `template: ${JSON.stringify(compiled.transformedTemplate)},\n  styles:`,
).replace(/SxBindingsDirective,\s*/g, '');

await mkdir(dirname(outputPath), { recursive: true });
await Promise.all([
  writeFile(outputPath, virtualSource),
  writeFile(setupPath, `// @ts-nocheck\n${compiled.generatedModule.contents}`),
]);
