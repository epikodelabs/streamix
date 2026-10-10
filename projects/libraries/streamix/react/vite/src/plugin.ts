import type { Plugin } from "vite";
import { dirname } from "node:path";
import ts from "typescript";
import {
  formatReactJsxDiagnostics,
  transformReactJsx,
} from "@epikodelabs/streamix/react/compiler";

export interface StreamixReactViteOptions {
  /** Optional filter for TSX module ids; node_modules is always excluded. */
  readonly include?: (id: string) => boolean;
}

/**
 * Native Vite host for the Streamix React compiler. Put this plugin before
 * the React JSX plugin so Streamix sees authored TSX and Vite composes the
 * returned original-source map with its normal JSX/source-map pipeline.
 */
export function sx(options: StreamixReactViteOptions = {}): Plugin {
  const programs = new Map<string, ts.Program>();
  const programFor = (fileName: string): ts.Program => {
    const configPath = ts.findConfigFile(dirname(fileName), ts.sys.fileExists, "tsconfig.json");
    const key = configPath ?? `standalone:${fileName}`;
    const cached = programs.get(key);
    if (cached) return cached;

    const configuration = configPath
      ? ts.readConfigFile(configPath, ts.sys.readFile)
      : { config: {} };
    const parsed = ts.parseJsonConfigFileContent(
      configuration.config ?? {},
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
    const program = ts.createProgram({ rootNames, options: parsed.options });
    programs.set(key, program);
    return program;
  };

  return {
    name: "streamix-react",
    enforce: "pre",
    transform(source, id) {
      const fileName = id.replace(/[?#].*$/, "");
      if (!fileName.endsWith(".tsx") || fileName.includes("/node_modules/")) return null;
      if (options.include && !options.include(fileName)) return null;

      const result = transformReactJsx(source, fileName, { program: programFor(fileName) });
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
      programs.clear();
    },
  };
}
