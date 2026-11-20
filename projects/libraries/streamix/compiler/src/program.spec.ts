import ts from 'typescript';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStreamixProgram, findStreamixProgramConfig, parseStreamixProgramConfig, streamixScriptKind } from './program';

describe('Shared Streamix program scaffolding', () => {
  it('parses standalone defaults with JavaScript and preserved JSX enabled', () => {
    const config = parseStreamixProgramConfig(undefined);

    expect(config.configPath).toBeUndefined();
    expect(config.fileNames).toEqual([]);
    expect(config.options.allowJs).toBeTrue();
    expect(config.options.jsx).toBe(ts.JsxEmit.Preserve);
    expect(config.options.module).toBe(ts.ModuleKind.ESNext);
    expect(config.options.moduleResolution).toBe(ts.ModuleResolutionKind.Bundler);
  });

  it('serves overlays with canonicalized keys and one SourceFile per path', () => {
    const program = createStreamixProgram(
      { fileNames: [], options: { noLib: true, jsx: ts.JsxEmit.Preserve, allowJs: true } },
      new Map([
        ['C:\\App\\Src\\view.tsx', 'export const view = <span />;'],
        ['C:/App/src/store.vue.ts', 'export const store = 1;'],
      ]),
    );

    const view = program.getSourceFile('C:/App/Src/view.tsx');
    expect(view).toBeDefined();
    // Separator and case variants resolve through the same overlay entry and
    // the same SourceFile instance, so symbols never split across nodes.
    expect(program.getSourceFile('c:/app/src/view.tsx')).toBe(ts.sys.useCaseSensitiveFileNames ? undefined : view);
    expect(program.getSourceFile('C:/App/src/store.vue.ts')?.text).toContain('export const store');
  });

  it('keeps case-distinct overlays on case-sensitive hosts', () => {
    const nativeCaseSensitivity = ts.sys.useCaseSensitiveFileNames;
    try {
      for (const caseSensitive of [true, false]) {
        ts.sys.useCaseSensitiveFileNames = caseSensitive;
        const program = createStreamixProgram(
          { fileNames: [], options: { noLib: true } },
          new Map([['/src/Foo.ts', 'export const upper = 1;'], ['/src/foo.ts', 'export const lower = 2;']]),
        );
        const lower = program.getSourceFile('/src/foo.ts');
        const upper = program.getSourceFile('/src/Foo.ts');
        expect(lower?.text).toContain('lower');
        if (caseSensitive) {
          expect(upper?.text).toContain('upper');
          expect(upper).not.toBe(lower);
        } else {
          expect(upper).toBe(lower);
        }
      }
    } finally {
      ts.sys.useCaseSensitiveFileNames = nativeCaseSensitivity;
    }
  });

  it('reports malformed JSON and invalid options with the authored config path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'streamix-config-'));
    const config = join(root, 'tsconfig.json');
    try {
      for (const contents of ['{"compilerOptions":', '{"compilerOptions":{"module":"bogus"}}', '{"compilerOptions":[] }']) {
        await writeFile(config, contents);
        const path = config.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(() => parseStreamixProgramConfig(config)).toThrowError(new RegExp(path));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses a populated workspace config for a solution-style app config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'streamix-config-fallback-'));
    try {
      const app = join(root, 'app');
      await mkdir(app);
      await writeFile(join(app, 'tsconfig.json'), '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}');
      await writeFile(join(root, 'tsconfig.json'), '{"files":["workspace.ts"]}');
      await writeFile(join(root, 'workspace.ts'), 'export {};');
      const resolved = findStreamixProgramConfig(app, root);
      expect(resolved.fileNames.map(path => path.replace(/\\/g, '/'))).toEqual([join(root, 'workspace.ts').replace(/\\/g, '/')]);
      expect(resolved.options.jsx).toBe(ts.JsxEmit.Preserve);
      expect(resolved.options.allowJs).toBeTrue();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reuses unchanged disk and overlay ASTs while observing changed files and overlays', async () => {
    const root = await mkdtemp(join(tmpdir(), 'streamix-program-reuse-'));
    try {
      const stable = join(root, 'stable.ts');
      const edited = join(root, 'edited.ts');
      const overlay = join(root, 'virtual.ts');
      const changedOverlay = join(root, 'changed.ts');
      await writeFile(stable, 'export const stable = 1;');
      await writeFile(edited, 'export const edited = 1;');
      const config = { fileNames: [stable, edited], options: { noLib: true } };
      const overlays = new Map([[overlay, 'export const stable = 1;'], [changedOverlay, 'export const edited = 1;']]);
      const previous = createStreamixProgram(config, overlays);
      const checker = previous.getTypeChecker();
      expect(checker.getSymbolAtLocation(previous.getSourceFile(overlay)!)).toBeDefined();
      await writeFile(edited, 'export const edited = 2;');
      overlays.set(changedOverlay, 'export const edited = 2;');
      const next = createStreamixProgram(config, overlays, previous);
      for (const path of [stable, overlay]) expect(next.getSourceFile(path)).toBe(previous.getSourceFile(path));
      for (const path of [edited, changedOverlay]) {
        expect(next.getSourceFile(path)).not.toBe(previous.getSourceFile(path));
        expect(next.getSourceFile(path)?.text).toContain('= 2');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reuses programs with duplicate package versions without returning redirect files from the host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'streamix-program-redirect-'));
    try {
      const entries = [];
      for (const app of ['first', 'second']) {
        const local = join(root, app);
        const pkg = join(local, 'node_modules', 'example-package');
        await mkdir(pkg, { recursive: true });
        await writeFile(join(pkg, 'package.json'), '{"name":"example-package","version":"1.0.0","types":"index.d.ts"}');
        await writeFile(join(pkg, 'index.d.ts'), 'export declare const value: number;');
        const entry = join(local, 'entry.ts');
        await writeFile(entry, 'export { value } from "example-package";');
        entries.push(entry);
      }
      const config = { fileNames: entries, options: { noLib: true, moduleResolution: ts.ModuleResolutionKind.Node10 } };
      const previous = createStreamixProgram(config, new Map());
      expect(previous.getSourceFiles().filter(file => file.fileName.endsWith('/example-package/index.d.ts')).length).toBe(2);
      const next = createStreamixProgram(config, new Map([[entries[0], 'export { value as renamed } from "example-package";']]), previous);
      expect(next.getSourceFile(entries[0])?.text).toContain('as renamed');
      expect(next.getSourceFile(entries[1])).toBe(previous.getSourceFile(entries[1]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('routes overlay files to TypeScript script kinds by extension', () => {
    expect(streamixScriptKind('view.tsx')).toBe(ts.ScriptKind.TSX);
    expect(streamixScriptKind('view.jsx')).toBe(ts.ScriptKind.JSX);
    expect(streamixScriptKind('view.js')).toBe(ts.ScriptKind.JS);
    expect(streamixScriptKind('view.vue.ts')).toBe(ts.ScriptKind.TS);
  });
});
