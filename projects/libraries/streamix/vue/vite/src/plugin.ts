import type { Plugin } from 'vite';
import { basename, dirname } from 'node:path';
import ts from 'typescript';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { injectIntrospectionActivation, instrumentStreamixSource } from '@epikodelabs/streamix/compiler';
import {
  transformVueSfc,
  formatVueSfcDiagnostics,
} from '@epikodelabs/streamix/vue/compiler';

export interface StreamixVueViteOptions {
  /** Optional filter for SFC module ids; node_modules is always excluded. */
  readonly include?: (id: string) => boolean;
  /**
   * Builds the app with the inspector, mirroring the Angular builder's flag:
   * factory calls in SFC scripts and TS modules register with `__streamixDebug`
   * and the entry gets `__sxEnable()`/`__sxMount()`. Off (default) —
   * completely without.
   */
  readonly introspection?: boolean;
}

const ENTRY_NAMES = ['main.ts', 'main.js', 'index.ts', 'index.js'];

/**
 * Semantic program over the authored tree, with one virtual `<name>.vue.ts`
 * overlay per instrumented SFC script. Cached per tsconfig; rebuilt when the
 * overlay text changes (HMR edits are in-memory, not on disk).
 */
function instrumentProgram(
  fileName: string,
  source: string,
  virtualScripts: ReadonlyMap<string, string>,
): ts.Program {
  const configPath = ts.findConfigFile(dirname(fileName), ts.sys.fileExists, 'tsconfig.json');
  const rawConfig = configPath ? (ts.readConfigFile(configPath, ts.sys.readFile).config ?? {}) : {};
  const parsed = configPath
    ? ts.parseJsonConfigFileContent(
        { ...rawConfig, compilerOptions: { ...(rawConfig.compilerOptions ?? {}), allowJs: true } },
        ts.sys, dirname(configPath), { jsx: ts.JsxEmit.Preserve }, configPath,
      )
    : { fileNames: [] as string[], options: {
        jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      } as ts.CompilerOptions };
  const overlays = new Map(virtualScripts);
  overlays.set(fileName, source);
  const rootNames = [...new Set([...parsed.fileNames, ...overlays.keys()])];
  const host = ts.createCompilerHost({ ...parsed.options, allowJs: true });
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile?.bind(host);
  const fileExists = host.fileExists.bind(host);
  // Overlay keys come from join()-free ids with platform separators while the
  // program canonicalizes host paths; overlays are few, so match normalized.
  const overlayFor = (name: string): string | undefined => {
    const direct = overlays.get(name);
    if (direct !== undefined) return direct;
    const wanted = name.replace(/\\/g, '/').toLowerCase();
    for (const [key, value] of overlays) {
      if (key.replace(/\\/g, '/').toLowerCase() === wanted) return value;
    }
    return undefined;
  };
  const scriptKindFor = (name: string): ts.ScriptKind => {
    if (/\.tsx$/i.test(name)) return ts.ScriptKind.TSX;
    if (/\.jsx$/i.test(name)) return ts.ScriptKind.JSX;
    if (/\.js$/i.test(name)) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
  };
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = overlayFor(name);
    if (text === undefined) return getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    return ts.createSourceFile(name, text, languageVersion, true, scriptKindFor(name));
  };
  host.readFile = name => overlayFor(name) ?? readFile?.(name);
  host.fileExists = name => overlayFor(name) !== undefined || fileExists(name);
  return ts.createProgram({ rootNames, options: { ...parsed.options, allowJs: true }, host });
}

/**
 * Native Vite host for the Streamix Vue compiler. Put this plugin before the
 * Vue plugin so Streamix transforms authored SFCs and the Vue compiler sees
 * the bridged bindings.
 *
 * Raw atoms, deriveds, flows, and scopes declared in `<script setup>` are
 * adopted automatically: templates read and write them as ordinary Vue state
 * while Streamix stays the single owner of the values.
 *
 * Source maps preserve authored locations, and intentionally leave generated
 * bridge declarations and imports unmapped. Vite composes this map with Vue's.
 */
export function sxVue(options: StreamixVueViteOptions = {}): Plugin {
  /** Instrument one SFC: its script block registers through __streamixDebug. */
  const instrumentSfc = (source: string, fileName: string): string => {
    const parsed = parseSfc(source, { filename: fileName });
    const script = parsed.descriptor.scriptSetup ?? parsed.descriptor.script;
    if (!script) return source;
    const virtualName = fileName.replace(/\.vue$/i, '.vue.ts');
    const program = instrumentProgram(virtualName, script.content, new Map([[virtualName, script.content]]));
    const sourceFile = program.getSourceFile(virtualName);
    if (!sourceFile) return source;
    const instrumented = instrumentStreamixSource({ file: sourceFile, checker: program.getTypeChecker(),
      sourcePath: fileName, enabled: true });
    if (instrumented === script.content) return source;
    const start = source.indexOf(script.content, Math.max(0, source.indexOf('<script')));
    if (start < 0) return source;
    return source.slice(0, start) + instrumented + source.slice(start + script.content.length);
  };

  return {
    name: 'streamix-vue',
    enforce: 'pre',
    // An introspection build must activate the inspector even outside the dev
    // server, where Vite would otherwise leave import.meta.env.DEV false.
    config: () => options.introspection
      ? { define: { 'import.meta.env.DEV': 'true' } }
      : undefined,
    transform(source, id) {
      const fileName = id.replace(/[?#].*$/, '');

      if (fileName.includes('/node_modules/')) {
        return null;
      }

      if (options.include && !options.include(fileName)) {
        return null;
      }

      if (options.introspection && /\.vue$/i.test(fileName)) {
        // Registration before the SFC transform (compiler ordering): the Vue
        // compiler adopts the instrumented script, seeing through __sxDebug.
        source = instrumentSfc(source, fileName);
      }

      if (options.introspection && /\.[jt]sx?$/i.test(fileName) && !/\.(?:d|spec|test)\.[jt]sx?$/i.test(fileName)) {
        // TS modules and the entry: register factories, and activate the
        // inspector from the entry module.
        const program = instrumentProgram(fileName, source, new Map());
        const sourceFile = program.getSourceFile(fileName);
        if (sourceFile) {
          let code = instrumentStreamixSource({ file: sourceFile, checker: program.getTypeChecker(),
            sourcePath: fileName, enabled: true });
          if (ENTRY_NAMES.includes(basename(fileName).toLowerCase())) code = injectIntrospectionActivation(code);
          if (code !== source) return { code, map: null };
        }
        return null;
      }

      if (!fileName.endsWith('.vue')) {
        return null;
      }

      // Attribute order is intentionally unconstrained: both `<script setup
      // lang="ts">` and `<script lang="ts" setup>` are standard SFCs.
      if (!/<script\b[^>]*\bsetup\b[^>]*>/i.test(source) || !/<template\b/i.test(source)) {
        return null;
      }

      const result = transformVueSfc(source, fileName);

      for (const warning of result.diagnostics.filter(item => item.category === 'warning')) {
        this.warn(formatVueSfcDiagnostics(source, fileName, [warning]));
      }

      const errors = result.diagnostics.filter(diagnostic => diagnostic.category === 'error');

      if (errors.length > 0) {
        this.error(formatVueSfcDiagnostics(source, fileName, errors));
      }

      if (result.bindingCount === 0) {
        return null;
      }

      return { code: result.code, map: result.sourceMap ?? null };
    },
  };
}
