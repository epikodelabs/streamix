import ts from 'typescript';
import { createStreamixProgram, parseStreamixProgramConfig, streamixScriptKind } from './program';

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

    const view = program.getSourceFile('C:/App/src/view.tsx');
    expect(view).toBeDefined();
    // Separator and case variants resolve through the same overlay entry and
    // the same SourceFile instance, so symbols never split across nodes.
    expect(program.getSourceFile('c:/app/src/view.tsx')).toBe(view);
    expect(program.getSourceFile('C:/App/src/store.vue.ts')?.text).toContain('export const store');
  });

  it('routes overlay files to TypeScript script kinds by extension', () => {
    expect(streamixScriptKind('view.tsx')).toBe(ts.ScriptKind.TSX);
    expect(streamixScriptKind('view.jsx')).toBe(ts.ScriptKind.JSX);
    expect(streamixScriptKind('view.js')).toBe(ts.ScriptKind.JS);
    expect(streamixScriptKind('view.vue.ts')).toBe(ts.ScriptKind.TS);
  });
});
