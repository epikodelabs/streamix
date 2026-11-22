import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfiguration } from '@angular/compiler-cli';
import ts from 'typescript';
import { generateProject, regenerateAngularFile } from './generate-project';

const sourceRoot = 'projects/apps/demo/src';
const virtualConfig = '.angular/.streamix/demo/tsconfig.app.json';
const normalize = (path: string | undefined) => path?.replaceAll('\\', '/');
const diagnosticsHost: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => process.cwd(),
  getCanonicalFileName: path => path,
  getNewLine: () => '\n',
};

describe('Angular virtual tsconfig ownership', () => {
  it('maps CLI app roots into the virtual tree and preserves inherited exclusions and workspace imports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sx-angular-config-'));
    const src = join(root, sourceRoot);
    const write = (path: string, content: string) => writeFile(join(src, path), content);
    try {
      await mkdir(src, { recursive: true });
      await mkdir(join(root, 'shared'));
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
          experimentalDecorators: true, strict: true, types: [],
          paths: { '@fixture/shared': ['./shared/value.ts'] },
        },
        exclude: [`${sourceRoot}/**/*.ignored.ts`],
      }));
      await writeFile(join(root, 'shared/value.ts'), 'export const quantity = 2;');
      await write('../tsconfig.app.json', JSON.stringify({
        extends: '../../../tsconfig.json',
        compilerOptions: { rootDir: './src' },
        files: ['src/main.ts'],
        include: ['src/**/*.ts'],
      }));
      await write('globals.d.ts', `
        declare module '@epikodelabs/streamix' {
          export interface Writable<T> { type: 'atom'; value: T; subscribe(cb: () => void): () => void; }
          export function atom<T>(value: T): Writable<T>;
          export function derived<T>(fn: () => T): Writable<T>;
        }
        declare module '@epikodelabs/streamix/angular';
      `);
      await write('main.ts', `
        import { atom, derived } from '@epikodelabs/streamix';
        import { quantity } from '@fixture/shared';
        declare function Component(metadata: object): ClassDecorator;
        @Component({ selector: 'fixture-app', template: '<output>{{ total.value }}</output>' })
        export class App {
          quantity = atom(quantity);
          price = atom(3);
          total = derived(() => this.quantity * this.price);
        }
      `);
      await write('bad.ignored.ts', 'export const invalid: string = 42;');
      await generateProject({ workspaceRoot: root, sourceRoot });

      const configPath = join(root, virtualConfig);
      const configuration = readConfiguration(configPath);
      expect(configuration.errors).toEqual([]);
      expect(configuration.rootNames.map(normalize).sort()).toEqual([
        `${normalize(root)}/.angular/.streamix/demo/src/globals.d.ts`,
        `${normalize(root)}/.angular/.streamix/demo/src/main.ts`,
      ]);
      expect(normalize(configuration.options.rootDir)).toBe(normalize(root));
      expect(await readFile(configuration.rootNames.find(name => name.endsWith('main.ts'))!, 'utf8'))
        .toContain('derived(() => this.quantity.value * this.price.value)');
      const program = ts.createProgram(configuration.rootNames, configuration.options);
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(diagnostics).withContext(ts.formatDiagnostics(diagnostics, diagnosticsHost)).toEqual([]);

      await write('new-entry.ts', 'export const entry = true;');
      await regenerateAngularFile(root, sourceRoot, 'new-entry.ts');
      expect(readConfiguration(configPath).rootNames.map(normalize))
        .toContain(`${normalize(root)}/.angular/.streamix/demo/src/new-entry.ts`);
      await rm(join(src, 'new-entry.ts'));
      await regenerateAngularFile(root, sourceRoot, 'new-entry.ts');
      expect(readConfiguration(configPath).rootNames.map(normalize))
        .not.toContain(`${normalize(root)}/.angular/.streamix/demo/src/new-entry.ts`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('refuses block markers in the projected content of an imported attribute component', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sx-angular-projection-'));
    const src = join(root, sourceRoot);
    const write = (path: string, content: string) => writeFile(join(src, path), content);
    try {
      await mkdir(src, { recursive: true });
      await write('../tsconfig.app.json', JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true },
        include: ['src/**/*.ts'],
      }));
      await write('globals.d.ts', `
        declare function Component(metadata: object): ClassDecorator;
        declare function NgModule(metadata: object): ClassDecorator;
        declare module '@epikodelabs/streamix' {
          export interface Writable<T> { type: 'atom'; value: T; subscribe(cb: () => void): () => void; }
          export function atom<T>(value: T): Writable<T>;
        }
      `);
      await write('cards.ts', `
        @Component({ selector: 'div[card]', standalone: false, template: '<section><ng-content /></section>' })
        export class Card {}
        @NgModule({ declarations: [Card], exports: [Card] })
        export class Cards {}
      `);
      const parent = (attribute: string) => `
        import { atom } from '@epikodelabs/streamix';
        import { Cards } from './cards';
        const imports = [Cards];
        @Component({ selector: 'fixture-app', imports, template: '<div ${attribute}>@if (ready) { <p>yes</p> }</div>' })
        export class App { readonly ready = atom(true); }
      `;
      await write('app.ts', parent('card'));
      await expectAsync(generateProject({ workspaceRoot: root, sourceRoot }))
        .toBeRejectedWithError(/static element topology.*projection/i);
      await write('app.ts', parent('unrelated'));
      await generateProject({ workspaceRoot: root, sourceRoot });
      expect(await readFile(join(root, '.angular/.streamix/demo/src/app.ts'), 'utf8')).toContain('data-sx-block');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
