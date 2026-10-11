import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import {
  formatVueSfcDiagnostics,
  transformVueSfc,
} from '@epikodelabs/streamix/vue/compiler';

/** Creates a clean virtual Vue project for the delegate target. */
export async function generateVueProject(workspaceRoot: string, sourceRoot: string): Promise<string> {
  const source = join(workspaceRoot, sourceRoot);
  const output = join(workspaceRoot, '.angular', '.streamix', virtualRootOf(sourceRoot));
  await rm(output, { recursive: true, force: true });
  await mkdir(dirname(output), { recursive: true });
  await cp(source, output, { recursive: true });

  for (const file of await collectVueFiles(output)) {
    await transformFile(file, relative(workspaceRoot, file));
  }

  return output;
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
): Promise<void> {
  const originalRoot = join(workspaceRoot, sourceRoot);
  const destRoot = join(workspaceRoot, '.angular', '.streamix', virtualRootOf(sourceRoot));
  const normalized = changedPath.replace(/\\/g, '/');
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('/../')) return;

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

  await mkdir(dirname(destination), { recursive: true });
  // Write only after a successful transform: a watch failure never leaves a
  // misleading, untransformed SFC in the delegated project.
  await writeFile(destination, output);
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

async function transformFile(file: string, fileName: string): Promise<void> {
  const input = await readFile(file, 'utf8');
  const transformed = transformVueSfc(input, fileName);
  const errors = transformed.diagnostics.filter(diagnostic => diagnostic.category === 'error');
  if (errors.length > 0) {
    throw new Error(formatVueSfcDiagnostics(input, fileName, errors));
  }
  await writeFile(file, transformed.code);
}
