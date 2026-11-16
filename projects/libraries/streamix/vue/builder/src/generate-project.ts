import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { injectIntrospectionActivation, instrumentStreamixSource } from '@epikodelabs/streamix/compiler';
import {
  formatVueSfcDiagnostics,
  transformVueSfc,
} from '@epikodelabs/streamix/vue/compiler';

/** Creates a clean virtual Vue project for the delegate target. */
export async function generateVueProject(workspaceRoot: string, sourceRoot: string, introspection = false): Promise<string> {
  const source = validatedSourceDirectory(workspaceRoot, sourceRoot);
  const output = join(workspaceRoot, '.angular', '.streamix', virtualRootOf(sourceRoot));
  await mkdir(dirname(output), { recursive: true });
  await sweepAbandonedTransactions(output);
  const staging = join(dirname(output), `.${basename(output)}-sx-stage-${randomUUID()}`);
  const backup = join(dirname(output), `.${basename(output)}-sx-backup-${randomUUID()}`);
  let backedUp = false;
  let installed = false;
  try {
    await cp(source, staging, { recursive: true });
    await stripLegacySidecars(staging);
    if (introspection) {
      // Metadata registration before the SFC transform (Angular reference
      // order): adoption then rewrites the instrumented script content.
      await instrumentVueTree(workspaceRoot, source, staging);
    }
    for (const file of await collectVueFiles(staging)) {
      await transformFile(file, relative(workspaceRoot, join(source, relative(staging, file))));
    }
    if (introspection) {
      const entry = await findEntry(staging);
      if (entry !== undefined) {
        // Devtools activation is injected into the generated entry only,
        // mirroring the Angular builder: authored source stays clean and the
        // gate stays `import.meta.env.DEV`, so production builds carry inert
        // definitions.
        await writeFile(entry, injectIntrospectionActivation(await readFile(entry, 'utf8')));
      }
    }
    try {
      await rename(output, backup);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(staging, output);
    installed = true;
    return output;
  } catch (error) {
    if (backedUp && !installed) await rename(backup, output);
    throw error;
  } finally {
    await rm(staging, { force: true, recursive: true });
    if (installed && backedUp) await rm(backup, { force: true, recursive: true });
  }
}

/** Deletes staging and backup siblings abandoned by a crashed generation, and
 * restores the last good tree when a crash landed between the swap renames.
 * Only UUID-shaped matches of this builder's own naming are touched. */
async function sweepAbandonedTransactions(output: string): Promise<void> {
  const abandoned = new RegExp(
    `^\\.${basename(output)}-sx-(?:stage|backup)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    'i',
  );
  const leftovers = (await readdir(dirname(output), { withFileTypes: true })
    .catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return [];
    }))
    .filter(entry => abandoned.test(entry.name))
    .map(entry => join(dirname(output), entry.name));
  if (leftovers.length === 0) return;
  const backups = leftovers.filter(path => basename(path).includes('-sx-backup-')).sort();
  let restored = false;
  if (backups.length > 0) {
    try {
      await access(output);
    } catch {
      await rename(backups[0], output);
      restored = true;
    }
  }
  for (const leftover of leftovers) {
    if (restored && leftover === backups[0]) continue;
    await rm(leftover, { force: true, recursive: true });
  }
}

/** Prevent traversal, workspace-wide recursion, and arbitrary absolute roots. */
export function validatedSourceDirectory(workspaceRoot: string, sourceRoot: string): string {
  const parts = sourceRoot.replace(/\\/g, '/').split('/');
  if (!sourceRoot || isAbsolute(sourceRoot) || win32.isAbsolute(sourceRoot) ||
      parts.some(part => part === '..' || part === '.' || part === '.angular' || part === 'node_modules') ||
      !parts.some(Boolean)) {
    throw new Error('Streamix Vue sourceRoot must be a nonempty workspace-relative source directory.');
  }
  const workspace = resolve(workspaceRoot);
  const source = resolve(workspaceRoot, sourceRoot);
  const rel = relative(workspace, source);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Streamix Vue sourceRoot must identify a directory inside the workspace.');
  }
  return source;
}

/** Maps an authored source root to its isolated virtual-project location. */
export function virtualRootOf(sourceRoot: string): string {
  return sourceRoot
    .replace(/^projects[\\/]apps[\\/]/, '')
    .replace(/[\\/]src$/, '/src');
}

/** Legacy generated `.sx.ts` sidecars copied from the authored tree must not
 * reach the virtual compilation inputs; the staged copy strips them. */
async function stripLegacySidecars(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await stripLegacySidecars(path);
    else if (entry.name.endsWith('.sx.ts')) await rm(path, { force: true });
  }
}

/** Semantic program over the authored tree; overlays replace real files and add virtual script modules. */
function createSourceProgram(workspaceRoot: string, sourceRoot: string, overlays = new Map<string, string>()): ts.Program {
  const source = resolve(workspaceRoot, sourceRoot);
  const sourceConfigPath = ts.findConfigFile(source, ts.sys.fileExists, 'tsconfig.json');
  const workspaceConfigPath = ts.findConfigFile(workspaceRoot, ts.sys.fileExists, 'tsconfig.json');
  const parseConfig = (configPath: string | undefined) => {
    const rawConfig = configPath ? (ts.readConfigFile(configPath, ts.sys.readFile).config ?? {}) : {};
    return configPath
      ? ts.parseJsonConfigFileContent(
          { ...rawConfig, compilerOptions: { ...(rawConfig.compilerOptions ?? {}), allowJs: true } },
          ts.sys, dirname(configPath), { jsx: ts.JsxEmit.Preserve }, configPath,
        )
      : { fileNames: [] as string[], options: {
          jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
        } as ts.CompilerOptions };
  };
  // Solution-style app tsconfigs (`files: []` + references) give the checker
  // no roots; instrumentation then queries unloaded nodes and can crash
  // TypeScript. Use the workspace program instead.
  let parsed = parseConfig(sourceConfigPath);
  if (parsed.fileNames.length === 0 && workspaceConfigPath && workspaceConfigPath !== sourceConfigPath) {
    parsed = parseConfig(workspaceConfigPath);
  }
  const rootNames = [...new Set([...parsed.fileNames, ...overlays.keys()])];
  // Overlay keys come from join() and keep platform separators, while the
  // program canonicalizes host paths to forward slashes (and Windows drive
  // casing varies). Overlays are tiny: match on normalized forms.
  const overlayFor = (fileName: string): string | undefined => {
    const direct = overlays.get(fileName);
    if (direct !== undefined) return direct;
    const wanted = fileName.replace(/\\/g, '/').toLowerCase();
    for (const [key, value] of overlays) {
      if (key.replace(/\\/g, '/').toLowerCase() === wanted) return value;
    }
    return undefined;
  };
  const host = ts.createCompilerHost({ ...parsed.options, allowJs: true });
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile?.bind(host);
  const fileExists = host.fileExists.bind(host);
  // TypeScript may ask for the same file more than once. Returning a fresh
  // SourceFile each time splits nodes and symbols across instances and
  // corrupts the checker during instrumentation.
  const overlaySources = new Map<string, ts.SourceFile>();
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = overlayFor(fileName);
    if (text === undefined) return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    const key = fileName.replace(/\\/g, '/').toLowerCase();
    let source = overlaySources.get(key);
    if (!source) {
      source = ts.createSourceFile(fileName, text, languageVersion, true, scriptKindFor(fileName));
      overlaySources.set(key, source);
    }
    return source;
  };
  host.readFile = fileName => overlayFor(fileName) ?? readFile?.(fileName);
  host.fileExists = fileName => overlayFor(fileName) !== undefined || fileExists(fileName);
  return ts.createProgram({ rootNames, options: { ...parsed.options, allowJs: true }, host });
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.js$/i.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Metadata registration (Angular reference pass): wraps atom/derived/flow/scope
 * constructions in authored TS files and SFC script blocks with `__streamixDebug`,
 * so the inspector discovers them. SFC scripts are instrumented as virtual
 * `<name>.vue.ts` modules and spliced back before the SFC transform runs.
 */
async function instrumentVueTree(workspaceRoot: string, source: string, staging: string): Promise<void> {
  const virtualScripts = new Map<string, string>();
  const sfcScripts = new Map<string, { path: string; virtualName: string; content: string }>();
  for (const file of await collectVueFiles(staging)) {
    const original = join(source, relative(staging, file));
    const parsed = parseSfc(await readFile(file, 'utf8'), { filename: original });
    const script = parsed.descriptor.scriptSetup ?? parsed.descriptor.script;
    if (!script) continue;
    const virtualName = original.replace(/\.vue$/i, '.vue.ts');
    virtualScripts.set(virtualName, script.content);
    sfcScripts.set(file, { path: original, virtualName, content: script.content });
  }

  const program = createSourceProgram(workspaceRoot, source, virtualScripts);
  const checker = program.getTypeChecker();

  for (const file of await collectScriptFiles(staging)) {
    const original = join(source, relative(staging, file));
    const input = await readFile(file, 'utf8');
    const sourceFile = program.getSourceFile(original) ?? ts.createSourceFile(original, input, ts.ScriptTarget.Latest, true);
    const instrumented = instrumentStreamixSource({ file: sourceFile, checker,
      sourcePath: relative(workspaceRoot, original), enabled: true });
    if (instrumented !== input) await writeFile(file, instrumented);
  }

  for (const [file, script] of sfcScripts) {
    const sourceFile = program.getSourceFile(script.virtualName);
    if (!sourceFile) continue;
    const instrumented = instrumentStreamixSource({ file: sourceFile, checker,
      sourcePath: relative(workspaceRoot, script.path), enabled: true });
    if (instrumented === script.content) continue;
    const text = await readFile(file, 'utf8');
    const start = text.indexOf(script.content, Math.max(0, text.indexOf('<script')));
    if (start < 0) continue;
    await writeFile(file, text.slice(0, start) + instrumented + text.slice(start + script.content.length));
  }
}

/** Single-file variant for watch regeneration of one SFC. */
async function instrumentVueFileText(workspaceRoot: string, sourceRoot: string, origin: string, text: string): Promise<string> {
  const parsed = parseSfc(text, { filename: origin });
  const script = parsed.descriptor.scriptSetup ?? parsed.descriptor.script;
  if (!script) return text;
  const virtualName = origin.replace(/\.vue$/i, '.vue.ts');
  const program = createSourceProgram(workspaceRoot, sourceRoot, new Map([[virtualName, script.content]]));
  const sourceFile = program.getSourceFile(virtualName);
  if (!sourceFile) return text;
  const instrumented = instrumentStreamixSource({ file: sourceFile, checker: program.getTypeChecker(),
    sourcePath: relative(workspaceRoot, origin), enabled: true });
  if (instrumented === script.content) return text;
  const start = text.indexOf(script.content, Math.max(0, text.indexOf('<script')));
  if (start < 0) return text;
  return text.slice(0, start) + instrumented + text.slice(start + script.content.length);
}

async function collectScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectScriptFiles(path));
    else if (entry.isFile() && /\.[jt]sx?$/i.test(path) && !/\.(?:d|spec|test)\.[jt]sx?$/i.test(path)) files.push(path);
  }
  return files;
}

/** Synchronizes one authored change into the delegated virtual project. */
export async function regenerateVueFile(
  workspaceRoot: string,
  sourceRoot: string,
  changedPath: string,
  introspection = false,
): Promise<void> {
  const originalRoot = validatedSourceDirectory(workspaceRoot, sourceRoot);
  const destRoot = join(workspaceRoot, '.angular', '.streamix', virtualRootOf(sourceRoot));
  const normalized = changedPath.replace(/\\/g, '/');
  if (!normalized || isAbsolute(normalized) || win32.isAbsolute(normalized) ||
      normalized.split('/').some(part => part === '..' || part === '.')) return;

  const origin = join(originalRoot, normalized);
  const destination = join(destRoot, normalized);
  let content: Buffer;
  try {
    content = await readFile(origin);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // fs.watch reports directory changes too. They are mirrored by the file
    // events that follow and must not be treated as failed source files.
    if (code === 'EISDIR') return;
    if (code !== 'ENOENT') throw error;
    await rm(destination, { force: true, recursive: true });
    await rm(`${destination}.map`, { force: true });
    return;
  }

  let output = content;
  let map: string | undefined;
  if (normalized.endsWith('.vue')) {
    let input = content.toString('utf8');
    if (introspection) input = await instrumentVueFileText(workspaceRoot, originalRoot, origin, input);
    const transformed = transformVueSfc(input, relative(workspaceRoot, origin));
    const errors = transformed.diagnostics.filter(diagnostic => diagnostic.category === 'error');
    if (errors.length > 0) {
      throw new Error(formatVueSfcDiagnostics(input, relative(workspaceRoot, origin), errors));
    }
    output = Buffer.from(transformed.code);
    map = transformed.sourceMap ? `${JSON.stringify(transformed.sourceMap)}\n` : undefined;
  } else if (introspection && /\.[jt]sx?$/i.test(normalized) && !/\.(?:d|spec|test)\.[jt]sx?$/i.test(normalized)) {
    const text = content.toString('utf8');
    const program = createSourceProgram(workspaceRoot, originalRoot, new Map([[origin, text]]));
    const sourceFile = program.getSourceFile(origin) ?? ts.createSourceFile(origin, text, ts.ScriptTarget.Latest, true);
    output = Buffer.from(instrumentStreamixSource({ file: sourceFile, checker: program.getTypeChecker(),
      sourcePath: relative(workspaceRoot, origin), enabled: true }));
  }
  // A watch edit of the entry must keep the injected activation, or the
  // first save would silently drop introspection until the next full regen.
  if (introspection && ENTRY_NAMES.includes(basename(normalized).toLowerCase())) {
    output = Buffer.from(injectIntrospectionActivation(output.toString('utf8')));
  }

  await mkdir(dirname(destination), { recursive: true });
  // Write only after a successful transform: a watch failure never leaves a
  // misleading, untransformed SFC in the delegated project.
  // Rename a same-directory temporary into place, so the delegate cannot
  // observe a partially written SFC while Vite recompiles a changed file.
  const temporary = `${destination}.sx-tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, output);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  if (map !== undefined) {
    const mapTemporary = `${destination}.map.sx-tmp-${randomUUID()}`;
    try {
      await writeFile(mapTemporary, map);
      await rename(mapTemporary, `${destination}.map`);
    } finally {
      await rm(mapTemporary, { force: true });
    }
  } else if (normalized.endsWith('.vue')) {
    // The transform produced no map (an unchanged passthrough), so a map from
    // an earlier generation would describe stale positions.
    await rm(`${destination}.map`, { force: true });
  }
}

async function collectVueFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectVueFiles(path));
    else if (entry.isFile() && path.endsWith('.vue')) files.push(path);
  }
  return files;
}

/** Entry bootstrap module names across common Vite layouts. */
const ENTRY_NAMES = ['main.tsx', 'main.jsx', 'main.ts', 'main.js', 'index.tsx', 'index.jsx', 'index.ts', 'index.js'];

/** The bootstrap module the delegate bundles, at the root or under src/. */
async function findEntry(root: string): Promise<string | undefined> {
  for (const directory of [join(root, 'src'), root]) {
    for (const name of ENTRY_NAMES) {
      const path = join(directory, name);
      try {
        await readFile(path);
        return path;
      } catch { /* not this one */ }
    }
  }
  return undefined;
}

async function transformFile(file: string, fileName: string): Promise<void> {
  const input = await readFile(file, 'utf8');
  const transformed = transformVueSfc(input, fileName);
  const errors = transformed.diagnostics.filter(diagnostic => diagnostic.category === 'error');
  if (errors.length > 0) {
    throw new Error(formatVueSfcDiagnostics(input, fileName, errors));
  }
  await writeFile(file, transformed.code);
  if (transformed.sourceMap) {
    // The compiler maps every surviving authored SFC text position onto its
    // original line and column; inserted bridges and imports stay unmapped.
    // The vite delegate chains this map so devtools point at authored files.
    await writeFile(`${file}.map`, `${JSON.stringify(transformed.sourceMap)}\n`);
  }
}
