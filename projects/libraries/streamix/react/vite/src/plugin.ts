import type { Plugin } from "vite";
import { dirname } from "node:path";
import ts from "typescript";
import {
  formatReactJsxDiagnostics,
  transformReactJsx,
} from "@epikodelabs/streamix/react/compiler";

export interface StreamixReactViteOptions {
  /** Optional filter for authored TS/TSX/JS/JSX modules; node_modules is always excluded. */
  readonly include?: (id: string) => boolean;
}

/**
 * Native Vite host for the Streamix React compiler. Put this plugin before
 * the React JSX plugin so Streamix sees authored TSX and Vite composes the
 * returned original-source map with its normal JSX/source-map pipeline.
 */
export function sx(options: StreamixReactViteOptions = {}): Plugin {
  const programs = new Map<string, ts.Program>();
  const previousPrograms = new Map<string, ts.Program>();
  const programFor = (fileName: string, source: string): ts.Program => {
    const configPath = ts.findConfigFile(dirname(fileName), ts.sys.fileExists, "tsconfig.json");
    const key = configPath ?? `standalone:${fileName}`;
    const cached = programs.get(key);
    // A Vite transform may receive an in-memory HMR edit not written to disk.
    // Never silently discard semantic analysis because its TS SourceFile is stale.
    if (cached?.getSourceFile(fileName)?.text === source) return cached;

    const configuration = configPath
      ? ts.readConfigFile(configPath, ts.sys.readFile)
      : { config: {} };
    const parsed = ts.parseJsonConfigFileContent(
      {
        ...(configuration.config ?? {}),
        compilerOptions: { ...(configuration.config?.compilerOptions ?? {}), allowJs: true },
      },
      ts.sys,
      configPath ? dirname(configPath) : dirname(fileName),
      configPath ? {} : {
        jsx: ts.JsxEmit.Preserve,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowJs: true,
        skipLibCheck: true,
      },
      configPath,
    );
    const rootNames = parsed.fileNames.includes(fileName)
      ? parsed.fileNames
      : [...parsed.fileNames, fileName];
    const host = ts.createCompilerHost(parsed.options);
    const getSourceFile = host.getSourceFile.bind(host);
    const readFile = host.readFile?.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
      name === fileName
        ? ts.createSourceFile(name, source, languageVersion, true, name.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TSX)
        : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    host.readFile = name => name === fileName ? source : readFile?.(name);
    host.fileExists = ((existing) => name => name === fileName || existing(name))(host.fileExists.bind(host));
    const program = ts.createProgram({ rootNames, options: { ...parsed.options, allowJs: true }, host, oldProgram: cached ?? previousPrograms.get(key) });
    previousPrograms.delete(key);
    programs.set(key, program);
    return program;
  };

  return {
    name: "streamix-react",
    enforce: "pre",
    transform(source, id) {
      const fileName = id.replace(/[?#].*$/, "");
      if (!/\.[jt]sx$/i.test(fileName) || /\.(?:d|spec|test)\.[jt]sx$/i.test(fileName) ||
          fileName.replace(/\\/g, "/").includes("/node_modules/")) return null;
      if (options.include && !options.include(fileName)) return null;

      const result = transformReactJsx(source, fileName, { program: programFor(fileName, source) });
      for (const warning of result.diagnostics.filter(item => item.category === "warning")) {
        this.warn(formatReactJsxDiagnostics(source, fileName, [warning]));
      }
      const errors = result.diagnostics.filter(diagnostic => diagnostic.category === "error");
      if (errors.length > 0) {
        this.error(formatReactJsxDiagnostics(source, fileName, errors));
      }
      return {
        code: result.code,
        map: result.sourceMap && {
          ...result.sourceMap,
          sources: [...result.sourceMap.sources],
          sourcesContent: [...result.sourceMap.sourcesContent],
          names: [...result.sourceMap.names],
        },
      };
    },
    watchChange() {
      // Source edits, config edits, and resolved re-exports can all change a
      // symbol's identity. Recreate the project graph on the next transform.
      for (const [key, program] of programs) previousPrograms.set(key, program);
      programs.clear();
    },
  };
}
