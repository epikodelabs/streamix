import { watch, type FSWatcher } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/** Workspace inputs outside the copied app tree must also invalidate it. */
export function libraryWatchRoots(workspaceRoot: string, sourceRoot: string): string[] {
  const workspace = resolve(workspaceRoot);
  const source = resolve(workspace, sourceRoot);
  const appConfig = resolve(source, '..', 'tsconfig.app.json');
  const config = ts.sys.fileExists(appConfig) ? appConfig :
    ts.findConfigFile(source, ts.sys.fileExists, 'tsconfig.json');
  if (!config) return [];
  const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {},
  });
  if (!parsed) return [];
  const inside = (root: string, file: string): boolean => {
    const rel = relative(root, file);
    return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
  };
  const allowed = (file: string): boolean => inside(workspace, file) && !inside(source, file) &&
    !relative(workspace, file).split(sep).some(part =>
      ['node_modules', '.angular', 'dist', '.git'].includes(part));
  const roots = new Set<string>();
  // Paths also cover Vue SFC dependencies that TypeScript cannot follow.
  const pathsBase = parsed.options.baseUrl ??
    (parsed.options as ts.CompilerOptions & { pathsBasePath?: string }).pathsBasePath ?? dirname(config);
  for (const targets of Object.values(parsed.options.paths ?? {})) {
    for (const target of targets) {
      const path = resolve(pathsBase, target.split('*')[0]);
      const directory = target.includes('*') ? path : dirname(path);
      if (allowed(directory) && directory !== workspace && ts.sys.directoryExists(directory)) roots.add(directory);
    }
  }
  const program = ts.createProgram(parsed.fileNames.filter(file => inside(source, file)), parsed.options);
  for (const file of program.getSourceFiles()) {
    if (!file.isDeclarationFile && allowed(file.fileName)) roots.add(resolve(dirname(file.fileName)));
  }
  return [...roots].filter(root => ![...roots].some(other => other !== root && inside(other, root)));
}

/** Separate entry points keep this Node-only helper local to each builder. */
export function watchLibraries(
  workspaceRoot: string,
  sourceRoot: string,
  onChange: () => void,
  warn: (message: string) => void,
): () => void {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const changed = (_event: string, filename: string | Buffer | null): void => {
    if (stopped) return;
    if (filename) {
      const file = String(filename);
      if (file.split(/[\\/]/).some(part => ['node_modules', '.angular', 'dist', '.git'].includes(part)) ||
          /(?:\.spec\.|\.test\.|\.sx-tmp(?:-|$))/.test(file)) return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => { if (!stopped) onChange(); }, 50);
  };
  const add = (directory: string, recursive: boolean): void => {
    const watcher = watch(directory, { recursive }, changed);
    watcher.on('error', error => warn(`Streamix library watcher: ${String(error)}`));
    watchers.push(watcher);
  };
  const fallback = (directory: string): void => {
    add(directory, false);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !['node_modules', '.angular', 'dist', '.git'].includes(entry.name)) {
        fallback(resolve(directory, entry.name));
      }
    }
  };
  for (const directory of libraryWatchRoots(workspaceRoot, sourceRoot)) {
    try { add(directory, true); }
    catch {
      try { if (statSync(directory).isDirectory()) fallback(directory); }
      catch (error) { warn(`Streamix could not watch ${directory}: ${String(error)}`); }
    }
  }
  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

/** Refresh in place: replacing the virtual directory interrupts live delegates. */
export async function refreshApplication(
  workspaceRoot: string,
  sourceRoot: string,
  regenerate: (workspace: string, source: string, file: string) => Promise<void>,
): Promise<void> {
  const root = resolve(workspaceRoot, sourceRoot);
  for (const file of ts.sys.readDirectory(root, ['.ts', '.tsx', '.js', '.jsx', '.vue'],
    ['**/*.spec.*', '**/*.test.*', '**/*.d.ts', '**/node_modules/**'])) {
    await regenerate(workspaceRoot, sourceRoot, relative(root, file));
  }
}
