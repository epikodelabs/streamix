import type { Plugin } from "vite";
import { basename, dirname } from "node:path";
import ts from "typescript";
import {
  formatReactJsxDiagnostics,
  transformReactJsx,
} from "@epikodelabs/streamix/react/compiler";
import {
  createStreamixProgram,
  findStreamixProgramConfig,
  injectIntrospectionActivation,
  instrumentStreamixSource,
  streamixScriptKind,
} from "@epikodelabs/streamix/compiler";

export interface StreamixReactViteOptions {
  /** Optional filter for authored TS/TSX/JS/JSX modules; node_modules is always excluded. */
  readonly include?: (id: string) => boolean;
  /**
   * Builds the app with the inspector, mirroring the Angular builder's flag:
   * factory calls register with `__streamixDebug` and the entry gets
   * first-import activation/`__sxMount()`. Off (default) — completely without.
   */
  readonly introspection?: boolean;
}

const ENTRY_NAMES = ["main.tsx", "main.jsx", "main.ts", "main.js", "index.tsx", "index.jsx", "index.ts", "index.js"];

/**
 * Native Vite host for the Streamix React compiler. Put this plugin before
 * the React JSX plugin so Streamix sees authored TSX and Vite composes the
 * returned original-source map with its normal JSX/source-map pipeline.
 */
export function sx(options: StreamixReactViteOptions = {}): Plugin {
  const programs = new Map<string, ts.Program>();
  const programFor = (fileName: string, source: string): ts.Program => {
    // A solution-style app tsconfig (`files: []` + references) leaves the
    // checker with no roots; the shared resolver falls back to the Vite
    // workspace config so instrumentation never queries unloaded nodes.
    const config = findStreamixProgramConfig(dirname(fileName), process.cwd());
    const key = config.configPath ?? `standalone:${fileName}`;
    const cached = programs.get(key);
    // A Vite transform may receive an in-memory HMR edit not written to disk.
    // Never silently discard semantic analysis because its TS SourceFile is stale.
    if (cached?.getSourceFile(fileName)?.text === source) return cached;
    const program = createStreamixProgram(config, new Map([[fileName, source]]), cached);
    programs.set(key, program);
    return program;
  };

  return {
    name: "streamix-react",
    enforce: "pre",
    // An introspection build must activate the inspector even outside the dev
    // server, where Vite would otherwise leave import.meta.env.DEV false.
    config: () => options.introspection
      ? { define: { "import.meta.env.DEV": "true" } }
      : undefined,
    transform(source, id) {
      const fileName = sourceFileName(id);
      if (!/\.[jt]sx?$/i.test(fileName) || /\.(?:d|spec|test)\.[jt]sx?$/i.test(fileName) ||
          fileName.replace(/\\/g, "/").includes("/node_modules/")) return null;
      if (options.include && !options.include(fileName)) return null;
      // Adopt only files the compiler can touch: authored JSX, or a Streamix
      // import (reactive lowering applies to plain TS modules too). A regex
      // over comparisons (`a<b&&c>d`) and type assertions (`<Foo>x`) guessed
      // JSX and paid for a full semantic program; parse the extension-valid
      // candidates instead and skip everything else before programFor.
      if (!source.includes("@epikodelabs/streamix") && !containsJsx(source, fileName)) return null;

      const result = transformReactJsx(source, fileName, { program: programFor(fileName, source) });
      for (const warning of result.diagnostics.filter(item => item.category === "warning")) {
        this.warn(formatReactJsxDiagnostics(source, fileName, [warning]));
      }
      const errors = result.diagnostics.filter(diagnostic => diagnostic.category === "error");
      if (errors.length > 0) {
        this.error(formatReactJsxDiagnostics(source, fileName, errors));
      }
      let code = result.code;
      if (options.introspection) {
        // Registration after adoption (compiler ordering): wrap factory calls
        // in the transformed text, where the atom type is already resolved.
        const program = programFor(fileName, code);
        const sourceFile = program.getSourceFile(fileName);
        if (sourceFile) {
          code = instrumentStreamixSource({ file: sourceFile, checker: program.getTypeChecker(),
            sourcePath: fileName, enabled: true });
        }
        if (ENTRY_NAMES.includes(basename(fileName).toLowerCase())) code = injectIntrospectionActivation(code);
      }
      return {
        code,
        map: result.sourceMap && {
          ...result.sourceMap,
          sources: [...result.sourceMap.sources],
          sourcesContent: [...result.sourceMap.sourcesContent],
          names: [...result.sourceMap.names],
        },
      };
    },
    watchChange(id, change) {
      const fileName = sourceFileName(id);
      // Config and package edits can change options or module resolution for
      // every project, not only the one that lists the file.
      if (/\.json$/i.test(fileName)) {
        programs.clear();
        return;
      }
      const normalized = normalizePath(fileName);
      let matched = false;
      for (const [key, program] of programs) {
        // A source edit changes symbol identity for every project that has
        // already resolved that file; unrelated projects keep their graph.
        const configFilePath = program.getCompilerOptions()["configFilePath"];
        if ((typeof configFilePath === "string" && normalizePath(configFilePath) === normalized) ||
            program.getSourceFiles().some(file => normalizePath(file.fileName) === normalized)) {
          programs.delete(key);
          matched = true;
        }
      }
      // A newly created module can satisfy an import that previously failed
      // to resolve, and that dependency is absent from every cached graph.
      if (!matched && change.event === "create" && /\.[cm]?[jt]sx?$/i.test(fileName)) programs.clear();
    },
  };
}

/** A hash in a directory or file name is valid on disk, including on Windows. */
function sourceFileName(id: string): string {
  return id.replace(/(\.(?:[cm]?[jt]sx?|json))[?#].*$/i, "$1");
}

/** Program file names and Vite ids differ by separators and, on Windows,
 * drive casing. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** True only when the source parses to a real JSX node in a JSX-capable file. */
function containsJsx(source: string, fileName: string): boolean {
  if (!/\.[jt]sx$/i.test(fileName)) return false;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    streamixScriptKind(fileName),
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

