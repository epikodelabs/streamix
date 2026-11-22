import ts from 'typescript';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

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

/** Maps effective TypeScript roots from authored app paths to staged app paths. */
export function mapVirtualTypeScriptRoots(
  roots: readonly string[],
  source: string,
  output: string,
  includeExternal = true,
): string[] {
  return roots.flatMap(file => {
    const path = relative(source, file).replace(/\\/g, '/');
    const external = path === '..' || path.startsWith('../') || isAbsolute(path);
    if (external && !includeExternal) return [];
    const target = external ? file : resolve(output, path);
    const mapped = relative(dirname(output), target).replace(/\\/g, '/');
    return [mapped.startsWith('.') || isAbsolute(mapped) ? mapped : `./${mapped}`];
  });
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
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  if (raw.error) throwConfigErrors(configPath, [raw.error]);
  const compilerOptions: unknown = raw.config.compilerOptions;
  if (compilerOptions !== undefined &&
      (!compilerOptions || typeof compilerOptions !== 'object' || Array.isArray(compilerOptions))) {
    throw new Error(`Streamix could not read TypeScript configuration ${configPath}: "compilerOptions" must be an object.`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    raw.config,
    ts.sys,
    dirname(configPath),
    { jsx: ts.JsxEmit.Preserve, allowJs: true },
    configPath,
  );
  // A config with no disk inputs can still supply options for virtual roots.
  const errors = parsed.errors.filter(diagnostic => diagnostic.code !== 18003);
  if (errors.length) throwConfigErrors(configPath, errors);
  return { configPath, fileNames: parsed.fileNames, options: parsed.options };
}

function throwConfigErrors(configPath: string, diagnostics: readonly ts.Diagnostic[]): never {
  const errors = diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'));
  throw new Error(`Streamix could not read TypeScript configuration ${configPath}:\n${errors.join('\n')}`);
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
  if (/\.[cm]?js$/i.test(fileName)) return ts.ScriptKind.JS;
  if (/\.json$/i.test(fileName)) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

/** Overlay keys arrive from `join()` with platform separators, while the
 * program canonicalizes host paths to forward slashes (and Windows drive
 * casing varies). Index normalized paths once per program. */
export function streamixPathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
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
  const options = config.options;
  // Prefer the config's spelling when an overlay only differs by separators
  // or the casing of a path on a case-insensitive host.
  const roots = new Map<string, string>();
  for (const path of [...config.fileNames, ...overlays.keys()]) {
    const key = streamixPathKey(path);
    if (!roots.has(key)) roots.set(key, path);
  }
  const rootNames = [...roots.values()];
  if (overlays.size === 0 && oldProgram === undefined) return ts.createProgram({ rootNames, options });
  const normalizedOverlays = new Map([...overlays].map(([path, text]) => [streamixPathKey(path), text]));
  const overlayFor = (fileName: string): string | undefined => normalizedOverlays.get(streamixPathKey(fileName));
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile?.bind(host);
  const fileExists = host.fileExists.bind(host);
  const reusable = oldProgram && isDeepStrictEqual(oldProgram.getCompilerOptions(), options)
    ? new Map(oldProgram.getSourceFiles().map(file => {
        // TypeScript installs package redirects itself. Its host must return
        // the underlying parsed file during a rebuild, never the redirect.
        const redirect = (file as ts.SourceFile & {
          redirectInfo?: { unredirected: ts.SourceFile };
        }).redirectInfo;
        return [streamixPathKey(file.fileName), redirect?.unredirected ?? file];
      }))
    : undefined;
  const sources = new Map<string, ts.SourceFile>();
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const key = streamixPathKey(fileName);
    const cached = !shouldCreateNewSourceFile && sources.get(key);
    if (cached) return cached;
    const overlay = overlayFor(fileName);
    let text: string | undefined;
    try {
      text = overlay ?? readFile?.(fileName);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
      text = '';
    }
    if (text === undefined) return undefined;
    const previous = !shouldCreateNewSourceFile && reusable?.get(key);
    const target = typeof languageVersion === 'number' ? languageVersion : languageVersion.languageVersion;
    const format = typeof languageVersion === 'number' ? undefined : languageVersion.impliedNodeFormat;
    const source = previous && previous.text === text && previous.languageVersion === target &&
      previous.impliedNodeFormat === format
      ? previous
      : ts.createSourceFile(fileName, text, languageVersion, true,
          overlay === undefined ? undefined : streamixScriptKind(fileName));
    sources.set(key, source);
    return source;
  };
  host.readFile = fileName => overlayFor(fileName) ?? readFile?.(fileName);
  host.fileExists = fileName => overlayFor(fileName) !== undefined || fileExists(fileName);
  return ts.createProgram({ rootNames, options, host, oldProgram });
}
