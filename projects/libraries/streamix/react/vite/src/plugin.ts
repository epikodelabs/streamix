import type { Plugin } from "vite";
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
  return {
    name: "streamix-react",
    enforce: "pre",
    transform(source, id) {
      const fileName = id.replace(/[?#].*$/, "");
      if (!fileName.endsWith(".tsx") || fileName.includes("/node_modules/")) return null;
      if (options.include && !options.include(fileName)) return null;

      const result = transformReactJsx(source, fileName);
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
  };
}
