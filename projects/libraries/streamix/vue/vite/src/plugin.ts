import type { Plugin } from 'vite';
import { basename, dirname } from 'node:path';
import ts from 'typescript';
import { parse as parseSfc } from '@vue/compiler-sfc';
import {
  createStreamixProgram,
  findStreamixProgramConfig,
  injectIntrospectionActivation,
  instrumentStreamixSource,
} from '@epikodelabs/streamix/compiler';
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
   * and the entry gets first-import activation/`__sxMount()`. Off (default) —
   * completely without.
   */
  readonly introspection?: boolean;
}

const ENTRY_NAMES = ['main.tsx', 'main.jsx', 'main.ts', 'main.js', 'index.tsx', 'index.jsx', 'index.ts', 'index.js'];

/**
 * Semantic program over the authored tree, with one virtual `<name>.vue.ts`
 * overlay per instrumented SFC script. Solution-style configs (`files: []` +
 * references) fall back to the Vite workspace config.
 */
function instrumentProgramFor(
  programs: Map<string, ts.Program>,
  fileName: string,
  source: string,
  virtualScripts: ReadonlyMap<string, string>,
): ts.Program {
  // A solution-style app tsconfig (`files: []` + references) leaves the
  // checker with no roots; the shared resolver falls back to the Vite
  // workspace config so instrumentation never queries unloaded nodes.
  const config = findStreamixProgramConfig(dirname(fileName), process.cwd());
  const key = config.configPath ?? `standalone:${fileName}`;
  const cached = programs.get(key);
  // A Vite transform may receive an in-memory HMR edit not written to disk.
  // Never silently discard semantic analysis because its TS SourceFile is stale.
  if (cached?.getSourceFile(fileName)?.text === source) return cached;
  const overlays = new Map(virtualScripts);
  overlays.set(fileName, source);
  const program = createStreamixProgram(config, overlays, cached);
  programs.set(key, program);
  return program;
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
  // One semantic program per resolved tsconfig, reused across transforms and
  // invalidated by watchChange — mirroring the React Vite plugin's cache.
  const programs = new Map<string, ts.Program>();
  const instrumentProgram = (
    fileName: string,
    source: string,
    virtualScripts: ReadonlyMap<string, string>,
  ): ts.Program => instrumentProgramFor(programs, fileName, source, virtualScripts);

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
    watchChange(id, change) {
      const fileName = id.replace(/[?#].*$/, '');
      // Config and package edits can change options or module resolution for
      // every project, not only the one that lists the file.
      if (/\.json$/i.test(fileName)) {
        programs.clear();
        return;
      }
      const normalized = normalizePath(fileName);
      // An SFC's semantic program holds the virtual `<name>.vue.ts` script
      // overlay, never the authored `<name>.vue` file itself.
      const virtualVueName = /\.vue$/i.test(fileName)
        ? normalizePath(fileName.replace(/\.vue$/i, '.vue.ts'))
        : undefined;
      let matched = false;
      for (const [key, program] of programs) {
        // A source edit changes symbol identity for every project that has
        // already resolved that file; unrelated projects keep their graph.
        const configFilePath = program.getCompilerOptions()['configFilePath'];
        if ((typeof configFilePath === 'string' && normalizePath(configFilePath) === normalized) ||
            program.getSourceFiles().some(file => normalizePath(file.fileName) === normalized ||
              (virtualVueName !== undefined && normalizePath(file.fileName) === virtualVueName))) {
          programs.delete(key);
          matched = true;
        }
      }
      // A newly created module can satisfy an import that previously failed
      // to resolve, and that dependency is absent from every cached graph.
      if (!matched && change.event === 'create' && /\.(?:[cm]?[jt]sx?|vue)$/i.test(fileName)) {
        programs.clear();
      }
    },
  };
}

/** Program file names and Vite ids differ by separators and, on Windows,
 * drive casing. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}
