import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  formatVueSfcDiagnostics,
  transformVueSfc,
} from '@epikodelabs/streamix/vue/compiler';

/** Creates a clean virtual Vue project for the delegate target. */
export async function generateVueProject(workspaceRoot: string, sourceRoot: string, introspection = false): Promise<string> {
  const source = validatedSourceDirectory(workspaceRoot, sourceRoot);
  const output = join(workspaceRoot, '.angular', '.streamix', virtualRootOf(sourceRoot));
  await mkdir(dirname(output), { recursive: true });
  const staging = join(dirname(output), `.${basename(output)}-sx-stage-${randomUUID()}`);
  const backup = join(dirname(output), `.${basename(output)}-sx-backup-${randomUUID()}`);
  let backedUp = false;
  let installed = false;
  try {
    await cp(source, staging, { recursive: true });
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
        await writeFile(entry, withIntrospection(await readFile(entry, 'utf8')));
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

/** Prevent traversal, workspace-wide recursion, and arbitrary absolute roots. */
export function validatedSourceDirectory(workspaceRoot: string, sourceRoot: string): string {
  const parts = sourceRoot.replace(/\\/g, '/').split('/');
  if (!sourceRoot || isAbsolute(sourceRoot) || win32.isAbsolute(sourceRoot) ||
      parts.some(part => part === '..' || part === '.' || part === '.angular') ||
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
    return;
  }

  let output = content;
  if (normalized.endsWith('.vue')) {
    const input = content.toString('utf8');
    const transformed = transformVueSfc(input, relative(workspaceRoot, origin));
    const errors = transformed.diagnostics.filter(diagnostic => diagnostic.category === 'error');
    if (errors.length > 0) {
      throw new Error(formatVueSfcDiagnostics(input, relative(workspaceRoot, origin), errors));
    }
    output = Buffer.from(transformed.code);
  }
  // A watch edit of the entry must keep the injected activation, or the
  // first save would silently drop introspection until the next full regen.
  if (introspection && ENTRY_NAMES.includes(basename(normalized).toLowerCase())) {
    output = Buffer.from(withIntrospection(content.toString('utf8')));
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
const ENTRY_NAMES = ['main.ts', 'main.js', 'index.ts', 'index.js'];

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

/** Inject devtools activation into a generated entry, matching the Angular builder's template. */
function withIntrospection(code: string): string {
  return `import { enableStreamixIntrospection as __sxEnable, mountStreamixInspector as __sxMount } from '@epikodelabs/streamix';\n__sxEnable();\n${code}\n__sxMount();\n`;
}

async function transformFile(file: string, fileName: string): Promise<void> {
  const input = await readFile(file, 'utf8');
  const transformed = transformVueSfc(input, fileName);
  const errors = transformed.diagnostics.filter(diagnostic => diagnostic.category === 'error');
  if (errors.length > 0) {
    throw new Error(formatVueSfcDiagnostics(input, fileName, errors));
  }
  await writeFile(file, transformed.code);
}
