import ts from 'typescript';
import { dirname } from 'node:path';

/**
 * Configuration prepared for a Streamix semantic pass. Builders and Vite
 * plugins discover configs differently (source root vs. transformed file),
 * but they parse and consume them the same way.
 */
export interface StreamixProgramConfig {
  /** Path of the parsed config, or undefined when no config was found. */
  readonly configPath?: string;
  readonly fileNames: readonly string[];
  readonly options: ts.CompilerOptions;
}

/** Standalone defaults for hosts without a tsconfig (tests, virtual projects). */
const standaloneOptions: ts.CompilerOptions = {
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  skipLibCheck: true,
};

/**
 * Parses a tsconfig with the options Streamix transforms require: JavaScript
 * is allowed and authored JSX stays preserved for the framework transform.
 */
export function parseStreamixProgramConfig(configPath: string | undefined): StreamixProgramConfig {
  if (!configPath) return { fileNames: [], options: { ...standaloneOptions } };
  const raw = ts.readConfigFile(configPath, ts.sys.readFile).config ?? {};
  const parsed = ts.parseJsonConfigFileContent(
    { ...raw, compilerOptions: { ...(raw.compilerOptions ?? {}), allowJs: true } },
    ts.sys,
    dirname(configPath),
    { jsx: ts.JsxEmit.Preserve },
    configPath,
  );
  return { configPath, fileNames: parsed.fileNames, options: parsed.options };
}

/**
 * Finds the nearest tsconfig from `searchFrom`. A solution-style app config
 * (`files: []` + references) leaves the checker with no roots, so a distinct
 * config found from `fallbackFrom` with roots is used instead.
 */
export function findStreamixProgramConfig(searchFrom: string, fallbackFrom?: string): StreamixProgramConfig {
  const config = parseStreamixProgramConfig(ts.findConfigFile(searchFrom, ts.sys.fileExists, 'tsconfig.json'));
  if (config.fileNames.length > 0 || fallbackFrom === undefined) return config;
  const fallbackPath = ts.findConfigFile(fallbackFrom, ts.sys.fileExists, 'tsconfig.json');
  if (!fallbackPath || fallbackPath === config.configPath) return config;
  const fallback = parseStreamixProgramConfig(fallbackPath);
  return fallback.fileNames.length > 0 ? fallback : config;
}

/** Script kind for a synthetic or overlaid file, by extension. */
export function streamixScriptKind(fileName: string): ts.ScriptKind {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.js$/i.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Overlay keys arrive from `join()` with platform separators, while the
 * program canonicalizes host paths to forward slashes (and Windows drive
 * casing varies). Index normalized paths once per program. */
function overlayKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * Creates a semantic program with in-memory overlays. Overlay text replaces
 * disk content and can introduce virtual files. Each overlay keeps one
 * SourceFile instance: recreating it would split nodes and symbols across
 * instances and corrupt the checker.
 */
export function createStreamixProgram(
  config: StreamixProgramConfig,
  overlays: ReadonlyMap<string, string> = new Map(),
  oldProgram?: ts.Program,
): ts.Program {
  const options = { ...config.options, allowJs: true };
  const rootNames = [...new Set([...config.fileNames, ...overlays.keys()])];
  if (overlays.size === 0 && oldProgram === undefined) return ts.createProgram({ rootNames, options });
  const normalizedOverlays = new Map([...overlays].map(([path, text]) => [overlayKey(path), text]));
  const overlayFor = (fileName: string): string | undefined => normalizedOverlays.get(overlayKey(fileName));
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile?.bind(host);
  const fileExists = host.fileExists.bind(host);
  const overlaySources = new Map<string, ts.SourceFile>();
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = overlayFor(fileName);
    if (text === undefined) return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    const key = overlayKey(fileName);
    let source = overlaySources.get(key);
    if (!source) {
      source = ts.createSourceFile(fileName, text, languageVersion, true, streamixScriptKind(fileName));
      overlaySources.set(key, source);
    }
    return source;
  };
  host.readFile = fileName => overlayFor(fileName) ?? readFile?.(fileName);
  host.fileExists = fileName => overlayFor(fileName) !== undefined || fileExists(fileName);
  return ts.createProgram({ rootNames, options, host, oldProgram });
}
