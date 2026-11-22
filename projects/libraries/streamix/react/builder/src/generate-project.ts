import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import {
  createStreamixProgram,
  createTokenSourceMap,
  findStreamixProgramConfig,
  injectIntrospectionActivation,
  instrumentStreamixSource,
  mapVirtualTypeScriptRoots,
  parseStreamixProgramConfig,
  streamixPathKey,
} from "@epikodelabs/streamix/compiler";
import { formatReactJsxDiagnostics, transformReactJsx } from "@epikodelabs/streamix/react/compiler";

/** Creates a clean virtual React project for the delegate target. */
export async function generateReactProject(workspaceRoot: string, sourceRoot: string, introspection = false): Promise<string> {
  const source = validatedSourceDirectory(workspaceRoot, sourceRoot);
  const output = join(workspaceRoot, ".angular", ".streamix", virtualRootOf(sourceRoot));
  await mkdir(dirname(output), { recursive: true });
  await sweepAbandonedTransactions(output);
  // Transform into a staging sibling and only then swap: the delegate serves
  // the live tree, so a mid-pass failure must leave the previous generation
  // untouched instead of a wiped or half-compiled copy.
  const staging = join(dirname(output), `.${basename(output)}-sx-stage-${randomUUID()}`);
  const backup = join(dirname(output), `.${basename(output)}-sx-backup-${randomUUID()}`);
  let backedUp = false;
  let swapped = false;
  let committed = false;
  try {
    await cp(source, staging, { recursive: true });
    await stripLegacySidecars(staging);

    const entry = await findEntry(staging);
    const entryPath = entry ? relative(staging, entry).replace(/\\/g, "/") : undefined;
    const config = sourceProgramConfig(workspaceRoot, sourceRoot, entryPath && join(source, entryPath));
    const program = createStreamixProgram(config);
    const files = (await collectAdoptableFiles(staging)).filter(file =>
      !config.configPath || program.getSourceFile(join(source, relative(staging, file))));
    const results = new Map<string, { input: string; transformed: ReturnType<typeof transformReactJsx> }>();
    // Collect every file's diagnostics before failing: a single failure names
    // all affected authored files and preserves warnings alongside contract
    // errors instead of stopping at the first one.
    const failures: string[] = [];
    for (const file of files) {
      const original = join(source, relative(staging, file));
      const input = await readFile(file, "utf8");
      const transformed = transformReactJsx(input, original, { program });
      // Diagnostics point at the authored file, not the staging copy.
      if (transformed.diagnostics.some(diagnostic => diagnostic.category === "error")) {
        failures.push(formatReactJsxDiagnostics(input, relative(workspaceRoot, original), transformed.diagnostics));
        continue;
      }
      results.set(original, { input, transformed });
    }
    if (failures.length > 0) throw new Error(failures.join("\n\n"));
    // Registration runs AFTER adoption, not before: the adoption transform
    // typechecks the text it rewrites, and a __sxDebug wrapper around factory
    // calls would hide the atom type from it and silently disable adoption.
    // The registration pass then instruments the transformed texts, so its
    // metadata positions match the served virtual file. The program over the
    // transformed tree binds the __sxDebug import the pass inserts.
    const registrationProgram = introspection && results.size > 0
      ? createStreamixProgram(config, new Map([...results].map(([path, result]) => [path, result.transformed.code])), undefined, !config.configPath)
      : undefined;
    const outputs: Array<{ file: string; code: string; mapName: string; map: string }> = [];
    for (const file of files) {
      const original = join(source, relative(staging, file));
      const { input, transformed } = results.get(original)!;
      let code = transformed.code;
      if (registrationProgram) {
        const sourceFile = registrationProgram.getSourceFile(original) ?? ts.createSourceFile(original, code, ts.ScriptTarget.Latest, true);
        code = instrumentStreamixSource({ file: sourceFile, checker: registrationProgram.getTypeChecker(),
          sourcePath: relative(workspaceRoot, original), enabled: true });
      }
      if (introspection && file === entry) code = injectIntrospectionActivation(code, original);
      outputs.push({ file, code, mapName: `${basename(file)}.map`,
        map: serializeSourceMap(workspaceRoot, original, input, transformed, code) });
    }
    // Write only after the registration pass has finished. The program can
    // lazily read the virtual paths it also owns; letting it observe a
    // half-written, instrumented tree corrupts symbol resolution and can crash
    // TypeScript on a later file in projects that never import Streamix.
    for (const outputFile of outputs) {
      await writeFile(outputFile.file, `${outputFile.code}\n//# sourceMappingURL=${outputFile.mapName}\n`);
      await writeFile(join(dirname(outputFile.file), outputFile.mapName), outputFile.map);
    }
    // The tree root maps to `<app>/src` on the virtual tsconfig's level.
    const filesInConfig = mapVirtualTypeScriptRoots(
      config.fileNames, source, output,
    );
    // Atomically replace the live tree only after every transform succeeded:
    // rename tolerates a first-run missing output, and a failure before the
    // swap leaves the previous generation serving untouched.
    try {
      await rename(output, backup);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(staging, output);
    swapped = true;
    // The virtual tsconfig belongs to the generation: install it atomically
    // after the swap, and treat any failure until here as uncommitted so the
    // previous tree is restored rather than serving new sources with the old
    // configuration.
    await writeFileAtomic(
      join(dirname(output), "tsconfig.app.json"),
      `${JSON.stringify({
        ...(config.configPath ? { extends: toConfigPath(relative(dirname(output), config.configPath)) } : {}),
        compilerOptions: {
          // The program can combine generated files and authored workspace imports.
          rootDir: toConfigPath(relative(dirname(output), workspaceRoot)),
          outDir: "../../out-tsc/app", types: config.options.types ?? [], jsx: "react-jsx", allowJs: true,
        },
        files: filesInConfig,
        include: config.configPath ? [] : ["src/**/*"],
        exclude: config.configPath ? [] : ["src/**/*.spec.*", "src/**/*.test.*"],
      }, null, 2)}\n`,
    );
    committed = true;
    return output;
  } catch (error) {
    if (backedUp) {
      // Discard the uncommitted tree (it may have replaced the live one) and
      // put the last committed generation back, byte for byte.
      if (swapped) await rm(output, { force: true, recursive: true });
      await rename(backup, output);
      backedUp = false;
    }
    throw error;
  } finally {
    await rm(staging, { force: true, recursive: true });
    if (committed && backedUp) await rm(backup, { force: true, recursive: true });
  }
}

/** Deletes staging and backup siblings abandoned by a crashed generation, and
 * restores the last good tree when a crash landed between the swap renames.
 * Only UUID-shaped matches of this builder's own naming are touched. */
async function sweepAbandonedTransactions(output: string): Promise<void> {
  const abandoned = new RegExp(
    `^\\.${basename(output)}-sx-(?:stage|backup)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    "i",
  );
  const leftovers = (await readdir(dirname(output), { withFileTypes: true })
    .catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return [];
    }))
    .filter(entry => abandoned.test(entry.name))
    .map(entry => join(dirname(output), entry.name));
  if (leftovers.length === 0) return;
  const backups = leftovers.filter(path => basename(path).includes("-sx-backup-")).sort();
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
function validatedSourceDirectory(workspaceRoot: string, sourceRoot: string): string {
  const parts = sourceRoot.replace(/\\/g, "/").split("/");
  if (!sourceRoot || isAbsolute(sourceRoot) || win32.isAbsolute(sourceRoot) ||
      parts.some(part => part === ".." || part === "." || part === ".angular" || part === "node_modules") ||
      !parts.some(Boolean)) {
    throw new Error("Streamix React sourceRoot must be a nonempty workspace-relative source directory.");
  }
  const workspace = resolve(workspaceRoot);
  const source = resolve(workspaceRoot, sourceRoot);
  const rel = relative(workspace, source);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Streamix React sourceRoot must identify a directory inside the workspace.");
  }
  return source;
}

/** Writes via a same-directory temporary so the delegate never observes a
 * partially written file while Vite recompiles a change. */
async function writeFileAtomic(path: string, contents: string | Buffer): Promise<void> {
  const temporary = `${path}.sx-tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Atomically replaces a virtual file only when its bytes changed. */
async function writeIfChanged(path: string, contents: string | Buffer): Promise<void> {
  try {
    const current = await readFile(path);
    if (typeof contents === "string" ? current.toString("utf8") === contents : current.equals(contents)) {
      return;
    }
  } catch {
    // Missing or unreadable: write it.
  }
  await writeFileAtomic(path, contents);
}

export function virtualRootOf(sourceRoot: string): string {
  return sourceRoot
    .replace(/^projects[\\/]apps[\\/]/, "")
    .replace(/[\\/]src$/, "/src");
}

const ENTRY_NAMES = ["main.tsx", "main.jsx", "main.ts", "main.js", "index.tsx", "index.jsx", "index.ts", "index.js"];

/** Legacy generated `.sx.ts` sidecars copied from the authored tree must not
 * reach the virtual compilation inputs; the staged copy strips them. */
async function stripLegacySidecars(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await stripLegacySidecars(path);
    else if (entry.name.endsWith(".sx.ts")) await rm(path, { force: true });
  }
}

/** The bootstrap module the delegate bundles, at the root or under src/. */
async function findEntry(root: string): Promise<string | undefined> {
  for (const directory of [join(root, "src"), root]) {
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

function toConfigPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith(".") || isAbsolute(path) ? normalized : `./${normalized}`;
}

async function collectAdoptableFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectAdoptableFiles(path));
    else if (entry.isFile() && isAdoptablePath(path)) files.push(path);
  }
  return files;
}

function isAdoptablePath(path: string): boolean {
  return /\.[jt]sx?$/i.test(path) && !/\.(?:d|spec|test|sx)\.[jt]sx?$/i.test(path);
}

/** One semantic graph per phase and refresh; never retained across saves. */
export async function regenerateReactFiles(workspaceRoot: string, sourceRoot: string, changedPaths: readonly string[], introspection = false): Promise<void> {
  const source = validatedSourceDirectory(workspaceRoot, sourceRoot);
  const output = join(workspaceRoot, ".angular", ".streamix", virtualRootOf(sourceRoot));
  const overlays = new Map<string, string>();
  for (const changedPath of changedPaths) {
    const path = changedPath.replace(/\\/g, '/');
    if (!path || isAbsolute(path) || win32.isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.')) continue;
    if (!/\.[jt]sx?$/i.test(path) || /\.(?:spec|test)\.[jt]sx?$/i.test(path)) continue;
    const origin = join(source, path);
    let content: string | undefined;
    try { content = await readFile(origin, 'utf8'); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EISDIR') continue;
      if (code !== 'ENOENT') throw error;
    }
    const mirrored = await access(join(output, path)).then(() => true, error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    });
    if (mirrored !== (content !== undefined)) {
      await generateReactProject(workspaceRoot, sourceRoot, introspection);
      return;
    }
    if (content !== undefined && isAdoptablePath(path)) overlays.set(origin, content);
  }
  const results = new Map<string, ReturnType<typeof transformReactJsx>>();
  let config: ReturnType<typeof sourceProgramConfig> | undefined;
  if (overlays.size) {
    config = sourceProgramConfig(workspaceRoot, sourceRoot, await findEntry(source));
    const program = createStreamixProgram(config, overlays, undefined, !config.configPath);
    if (config.configPath) {
      // An edit can bring an unchanged, formerly excluded module into the
      // authored graph. Regenerate before publishing the importing file.
      const newlyReachable = program.getSourceFiles().filter(file =>
        !file.isDeclarationFile && isSourceDescendant(source, file.fileName) && isAdoptablePath(file.fileName));
      const alreadyTransformed = await Promise.all(newlyReachable.map(file =>
        access(join(output, relative(source, file.fileName)) + '.map').then(() => true, error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          return false;
        })));
      if (alreadyTransformed.includes(false)) {
        await generateReactProject(workspaceRoot, sourceRoot, introspection);
        return;
      }
    }
    // A batched watch save reports every failing file in one diagnostic, as
    // full regeneration does; nothing is written unless the batch is clean.
    const failures: string[] = [];
    for (const [origin, content] of overlays) {
      if (config.configPath && !program.getSourceFile(origin)) continue;
      const transformed = transformReactJsx(content, origin, { program });
      if (transformed.diagnostics.some(item => item.category === 'error')) {
        failures.push(formatReactJsxDiagnostics(content, relative(workspaceRoot, origin), transformed.diagnostics));
        continue;
      }
      results.set(origin, transformed);
    }
    if (failures.length) throw new Error(failures.join("\n\n"));
  }
  const registrationProgram = introspection && config && results.size
    ? createStreamixProgram(config, new Map([...results].map(([path, result]) => [path, result.code])), undefined, !config.configPath)
    : undefined;
  for (const path of changedPaths) await regenerateReactFileInternal(workspaceRoot, sourceRoot, path, introspection, { results, registrationProgram, overlays });
}

export async function regenerateReactFile(workspaceRoot: string, sourceRoot: string, changedPath: string, introspection = false): Promise<void> {
  await regenerateReactFiles(workspaceRoot, sourceRoot, [changedPath], introspection);
}

/** Synchronize an original source change into the delegated virtual project. */
async function regenerateReactFileInternal(workspaceRoot: string, sourceRoot: string, changedPath: string, introspection: boolean, batch: { results: Map<string, ReturnType<typeof transformReactJsx>>; registrationProgram?: ts.Program; overlays: Map<string, string> }): Promise<void> {
  const originalRoot = validatedSourceDirectory(workspaceRoot, sourceRoot);
  const destRoot = join(workspaceRoot, ".angular", ".streamix", virtualRootOf(sourceRoot));
  const normalized = changedPath.replace(/\\/g, "/");
  if (!normalized || isAbsolute(normalized) || win32.isAbsolute(normalized) ||
      normalized.split("/").some(part => part === ".." || part === ".")) return;
  const origin = join(originalRoot, normalized);
  const destination = join(destRoot, normalized);
  try { if (!batch.overlays.has(origin)) await readFile(origin); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EISDIR") return;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await rm(destination, { force: true, recursive: true });
    await rm(`${destination}.map`, { force: true });
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  if (isAdoptablePath(normalized)) {
    // Adoption and registration use the same authored snapshot for this batch.
    const transformed = batch.results.get(origin);
    if (!transformed) {
      const content = batch.overlays.get(origin);
      if (content !== undefined) {
        await writeIfChanged(destination, content);
        await rm(`${destination}.map`, { force: true });
      }
      return;
    }
    // Registration after adoption (see generateReactProject): the transformed
    // text is what the browser runs, so its positions are the honest metadata.
    let code = transformed.code;
    if (introspection) {
      const registrationProgram = batch.registrationProgram!;
      const sourceFile = registrationProgram.getSourceFile(origin) ?? ts.createSourceFile(origin, code, ts.ScriptTarget.Latest, true);
      code = instrumentStreamixSource({ file: sourceFile, checker: registrationProgram.getTypeChecker(),
        sourcePath: relative(workspaceRoot, origin), enabled: true });
    }
    // A watch edit of the entry must keep the injected activation, or the
    // first save would silently drop introspection until the next full regen.
    if (introspection && origin === await findEntry(originalRoot)) code = injectIntrospectionActivation(code, origin);
    await writeIfChanged(destination, `${code}\n//# sourceMappingURL=${basename(destination)}.map\n`);
    await writeIfChanged(`${destination}.map`, serializeSourceMap(workspaceRoot, origin, batch.overlays.get(origin)!, transformed, code));
  } else {
    // Mirrored assets are compared before replacing, so an unchanged watch
    // cycle does not touch the delegate tree.
    await writeIfChanged(destination, await readFile(origin));
  }
}

function serializeSourceMap(
  workspaceRoot: string,
  origin: string,
  input: string,
  transformed: ReturnType<typeof transformReactJsx>,
  code: string,
): string {
  const source = relative(workspaceRoot, origin).replace(/\\/g, "/");
  const map = code === transformed.code && transformed.sourceMap
    ? { ...transformed.sourceMap, sources: [source] }
    : createTokenSourceMap(input, code, source);
  return `${JSON.stringify(map)}\n`;
}

/** Share the semantic source graph with the Vite compiler, including imports.
 * Solution-style app tsconfigs (`files: []` + project references) give the
 * checker no roots; the shared resolver falls back to the workspace config,
 * which owns the real source graph. */
function isSourceDescendant(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== ".." && !path.startsWith("..\\") && !path.startsWith("../") && !isAbsolute(path);
}

function sourceProgramConfig(workspaceRoot: string, sourceRoot: string, entry?: string) {
  const source = resolve(workspaceRoot, sourceRoot);
  const appConfig = resolve(source, '..', 'tsconfig.app.json');
  const config = ts.sys.fileExists(appConfig) ? parseStreamixProgramConfig(appConfig)
    : findStreamixProgramConfig(source, workspaceRoot);
  const appOwnsConfig = !!config.configPath && relative(dirname(config.configPath), dirname(source)) === "";
  const roots = new Map<string, string>();
  if (entry) roots.set(streamixPathKey(entry), entry);
  for (const file of config.fileNames) {
    if (!/\.(?:spec|test|sx)\.[jt]sx?$/i.test(file) && (appOwnsConfig || isSourceDescendant(source, file))) {
      roots.set(streamixPathKey(file), file);
    }
  }
  return { ...config, fileNames: [...roots.values()] };
}
