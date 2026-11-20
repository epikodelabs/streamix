import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { parse as parseSfc } from '@vue/compiler-sfc';
import {
  createStreamixProgram,
  createTokenSourceMap,
  findStreamixProgramConfig,
  injectIntrospectionActivation,
  instrumentStreamixSource,
} from '@epikodelabs/streamix/compiler';
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
    // Collect every file's diagnostics before failing: one failure names all
    // affected authored SFCs instead of stopping at the first one.
    const failures: string[] = [];
    for (const file of await collectVueFiles(staging)) {
      const original = join(source, relative(staging, file));
      const failure = await transformFile(file, relative(workspaceRoot, original),
        introspection ? await readFile(original, 'utf8') : undefined);
      if (failure !== undefined) failures.push(failure);
    }
    if (failures.length > 0) throw new Error(failures.join('\n\n'));
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

/** Semantic program over the authored tree; overlays replace real files and
 * add virtual script modules. Solution-style app tsconfigs (`files: []` +
 * references) give the checker no roots; the shared resolver falls back to
 * the workspace config. */
function createSourceProgram(workspaceRoot: string, sourceRoot: string, overlays = new Map<string, string>()): ts.Program {
  const config = findStreamixProgramConfig(resolve(workspaceRoot, sourceRoot), workspaceRoot);
  return createStreamixProgram(config, overlays);
}

/**
 * Metadata registration (Angular reference pass): wraps atom/derived/flow/scope
 * constructions in authored TS files and SFC script blocks with `__streamixDebug`,
 * so the inspector discovers them. SFC scripts are instrumented as virtual
 * `<name>.vue.ts` modules and spliced back before the SFC transform runs.
 */
async function instrumentVueTree(workspaceRoot: string, source: string, staging: string): Promise<void> {
  const virtualScripts = new Map<string, string>();
  const sfcScripts = new Map<string, { path: string; virtualName: string; content: string; start: number }>();
  for (const file of await collectVueFiles(staging)) {
    const original = join(source, relative(staging, file));
    const parsed = parseSfc(await readFile(file, 'utf8'), { filename: original });
    const script = parsed.descriptor.scriptSetup ?? parsed.descriptor.script;
    if (!script) continue;
    const virtualName = original.replace(/\.vue$/i, '.vue.ts');
    virtualScripts.set(virtualName, script.content);
    sfcScripts.set(file, { path: original, virtualName, content: script.content, start: script.loc.start.offset });
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
    const { start } = script;
    await writeFile(file, text.slice(0, start) + instrumented + text.slice(start + script.content.length));
  }
}

/** Single-file variant for watch regeneration of one SFC. */
async function instrumentVueFileText(workspaceRoot: string, sourceRoot: string, origin: string, text: string, sharedProgram?: ts.Program): Promise<string> {
  const parsed = parseSfc(text, { filename: origin });
  const script = parsed.descriptor.scriptSetup ?? parsed.descriptor.script;
  if (!script) return text;
  const virtualName = origin.replace(/\.vue$/i, '.vue.ts');
  const program = sharedProgram ?? createSourceProgram(workspaceRoot, sourceRoot, new Map([[virtualName, script.content]]));
  const sourceFile = program.getSourceFile(virtualName);
  if (!sourceFile) return text;
  const instrumented = instrumentStreamixSource({ file: sourceFile, checker: program.getTypeChecker(),
    sourcePath: relative(workspaceRoot, origin), enabled: true });
  if (instrumented === script.content) return text;
  const start = script.loc.start.offset;
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

/** Share one introspection graph across every script in a watch batch. */
export async function regenerateVueFiles(workspaceRoot: string, sourceRoot: string, changedPaths: readonly string[], introspection = false): Promise<void> {
  const source = validatedSourceDirectory(workspaceRoot, sourceRoot);
  const overlays = new Map<string, string>();
  const inputs = new Map<string, Buffer>();
  if (introspection) for (const changedPath of changedPaths) {
    const path = changedPath.replace(/\\/g, '/');
    if (!path || isAbsolute(path) || win32.isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.')) continue;
    const origin = join(source, path);
    if (!/\.(?:vue|[jt]sx?)$/i.test(path) || /\.(?:d|spec|test)\.[jt]sx?$/i.test(path)) continue;
    try {
      const input = await readFile(origin);
      inputs.set(origin, input);
      const text = input.toString('utf8');
      if (path.endsWith('.vue')) {
        const parsed = parseSfc(text, { filename: origin });
        const script = parsed.descriptor.scriptSetup ?? parsed.descriptor.script;
        if (script) overlays.set(origin.replace(/\.vue$/i, '.vue.ts'), script.content);
      } else overlays.set(origin, text);
    } catch (error) { if (!['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }
  const program = overlays.size ? createSourceProgram(workspaceRoot, sourceRoot, overlays) : undefined;
  for (const path of changedPaths) await regenerateVueFileInternal(workspaceRoot, sourceRoot, path, introspection, program, inputs);
}

export async function regenerateVueFile(workspaceRoot: string, sourceRoot: string, changedPath: string, introspection = false): Promise<void> {
  await regenerateVueFiles(workspaceRoot, sourceRoot, [changedPath], introspection);
}

/** Synchronizes one authored change into the delegated virtual project. */
async function regenerateVueFileInternal(
  workspaceRoot: string,
  sourceRoot: string,
  changedPath: string,
  introspection: boolean,
  program: ts.Program | undefined,
  inputs: Map<string, Buffer>,
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
    content = inputs.get(origin) ?? await readFile(origin);
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
    const authored = content.toString('utf8');
    let input = authored;
    if (introspection) input = await instrumentVueFileText(workspaceRoot, originalRoot, origin, input, program);
    const transformed = transformVueSfc(input, relative(workspaceRoot, origin));
    const errors = transformed.diagnostics.filter(diagnostic => diagnostic.category === 'error');
    if (errors.length > 0) {
      throw new Error(formatVueSfcDiagnostics(input, relative(workspaceRoot, origin), errors));
    }
    output = Buffer.from(transformed.code);
    map = serializeSfcMap(authored, input, transformed, relative(workspaceRoot, origin));
  } else if (introspection && /\.[jt]sx?$/i.test(normalized) && !/\.(?:d|spec|test)\.[jt]sx?$/i.test(normalized)) {
    const text = content.toString('utf8');
    const registrationProgram = program ?? createSourceProgram(workspaceRoot, originalRoot, new Map([[origin, text]]));
    const sourceFile = registrationProgram.getSourceFile(origin) ?? ts.createSourceFile(origin, text, ts.ScriptTarget.Latest, true);
    output = Buffer.from(instrumentStreamixSource({ file: sourceFile, checker: registrationProgram.getTypeChecker(),
      sourcePath: relative(workspaceRoot, origin), enabled: true }));
  }
  // A watch edit of the entry must keep the injected activation, or the
  // first save would silently drop introspection until the next full regen.
  if (introspection && origin === await findEntry(originalRoot)) {
    output = Buffer.from(injectIntrospectionActivation(output.toString('utf8')));
  }

  await mkdir(dirname(destination), { recursive: true });
  // Write only after a successful transform: a watch failure never leaves a
  // misleading, untransformed SFC in the delegated project. Identical output
  // is left untouched so a no-content-change watch cycle does not wake the
  // delegate's watcher.
  await writeIfChanged(destination, output);
  if (map !== undefined) {
    await writeIfChanged(`${destination}.map`, map);
  } else if (normalized.endsWith('.vue')) {
    // The transform produced no map (an unchanged passthrough), so a map from
    // an earlier generation would describe stale positions.
    await rm(`${destination}.map`, { force: true });
  }
}

/**
 * Atomically replaces a virtual file only when its bytes changed.
 *
 * Rename a same-directory temporary into place, so the delegate cannot observe
 * a partially written file while Vite recompiles it.
 */
async function writeIfChanged(
  path: string,
  contents: string | Buffer,
): Promise<void> {
  try {
    const current = await readFile(path);
    if (typeof contents === 'string' ? current.toString('utf8') === contents : current.equals(contents)) {
      return;
    }
  } catch {
    // Missing or unreadable: write it.
  }

  const temporary = `${path}.sx-tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
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

/** Transforms one staged SFC; returns its formatted failure instead of
 * throwing so a full pass can report every affected file. */
async function transformFile(file: string, fileName: string, authored?: string): Promise<string | undefined> {
  const input = await readFile(file, 'utf8');
  const transformed = transformVueSfc(input, fileName);
  if (transformed.diagnostics.some(diagnostic => diagnostic.category === 'error')) {
    return formatVueSfcDiagnostics(input, fileName, transformed.diagnostics);
  }
  await writeFile(file, transformed.code);
  const map = serializeSfcMap(authored ?? input, input, transformed, fileName);
  if (map !== undefined) await writeFile(`${file}.map`, map);
  return undefined;
}

function serializeSfcMap(
  authored: string, input: string, transformed: ReturnType<typeof transformVueSfc>, fileName: string,
): string | undefined {
  const map = authored === input ? transformed.sourceMap : createTokenSourceMap(authored, transformed.code, fileName);
  return map && `${JSON.stringify(map)}\n`;
}
