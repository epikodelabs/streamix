import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { injectIntrospectionActivation, instrumentStreamixSource } from "@epikodelabs/streamix/compiler";
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
  let installed = false;
  try {
    await cp(source, staging, { recursive: true });
    await stripLegacySidecars(staging);

    const files = await collectAdoptableFiles(staging);
    const program = createSourceProgram(workspaceRoot, sourceRoot);
    const results = new Map<string, { code: string; map: string }>();
    for (const file of files) {
      const original = join(source, relative(staging, file));
      const input = await readFile(file, "utf8");
      const transformed = transformReactJsx(input, original, { program });
      const errors = transformed.diagnostics.filter(diagnostic => diagnostic.category === "error");
      if (errors.length > 0) {
        // Diagnostics point at the authored file, not the staging copy.
        throw new Error(formatReactJsxDiagnostics(input, relative(workspaceRoot, original), errors));
      }
      // Map sources carry the workspace-relative authored path so the chained
      // devtools point at a portable location instead of the machine's temp
      // workspace (mirrors the vite plugin's source rewrite).
      const mapSource = relative(workspaceRoot, original).replace(/\\/g, "/");
      results.set(original, {
        code: transformed.code,
        map: JSON.stringify(transformed.sourceMap && { ...transformed.sourceMap, sources: [mapSource] }),
      });
    }
    // Registration runs AFTER adoption, not before: the adoption transform
    // typechecks the text it rewrites, and a __sxDebug wrapper around factory
    // calls would hide the atom type from it and silently disable adoption.
    // The registration pass then instruments the transformed texts, so its
    // metadata positions match the served virtual file. The program over the
    // transformed tree binds the __sxDebug import the pass inserts.
    const registrationProgram = introspection && results.size > 0
      ? createSourceProgram(workspaceRoot, sourceRoot, new Map([...results].map(([path, result]) => [path, result.code])))
      : undefined;
    const outputs: Array<{ file: string; code: string; mapName: string; map: string }> = [];
    for (const file of files) {
      const original = join(source, relative(staging, file));
      const result = results.get(original)!;
      let code = result.code;
      if (registrationProgram) {
        const sourceFile = registrationProgram.getSourceFile(original) ?? ts.createSourceFile(original, code, ts.ScriptTarget.Latest, true);
        code = instrumentStreamixSource({ file: sourceFile, checker: registrationProgram.getTypeChecker(),
          sourcePath: relative(workspaceRoot, original), enabled: true });
      }
      outputs.push({ file, code, mapName: `${basename(file)}.map`, map: result.map });
    }
    // Write only after the registration pass has finished. The program can
    // lazily read the virtual paths it also owns; letting it observe a
    // half-written, instrumented tree corrupts symbol resolution and can crash
    // TypeScript on a later file in projects that never import Streamix.
    for (const outputFile of outputs) {
      await writeFile(outputFile.file, `${outputFile.code}\n//# sourceMappingURL=${outputFile.mapName}\n`);
      await writeFile(join(dirname(outputFile.file), outputFile.mapName), `${outputFile.map}\n`);
    }
    const entry = await findEntry(staging);
    // The tree root maps to `<app>/src` on the virtual tsconfig's level.
    const entryPath = entry ? relative(staging, entry).replace(/\\/g, "/") : undefined;
    if (introspection && entry !== undefined) {
      // Devtools activation is injected into the generated entry only, mirroring
      // the Angular builder: authored source stays clean and the gate stays
      // `import.meta.env.DEV`, so production builds carry inert definitions.
      await writeFile(entry, injectIntrospectionActivation(await readFile(entry, "utf8")));
    }
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
    installed = true;
    await writeFile(
      join(dirname(output), "tsconfig.app.json"),
      `${JSON.stringify({
        extends: toConfigPath(relative(dirname(output), join(workspaceRoot, "tsconfig.json"))),
        compilerOptions: { outDir: "../../out-tsc/app", types: [], jsx: "react-jsx", allowJs: true },
        files: entryPath ? [`src/${entryPath}`] : [],
        include: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.js", "src/**/*.jsx"],
        exclude: ["src/**/*.spec.*", "src/**/*.test.*", "src/**/*.d.ts"],
      }, null, 2)}\n`,
    );
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
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

async function collectAdoptableFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectAdoptableFiles(path));
    else if (entry.isFile() && /\.[jt]sx?$/i.test(path) && !/\.(?:d|spec|test)\.[jt]sx?$/i.test(path)) files.push(path);
  }
  return files;
}

/** One semantic graph per phase and refresh; never retained across saves. */
export async function regenerateReactFiles(workspaceRoot: string, sourceRoot: string, changedPaths: readonly string[], introspection = false): Promise<void> {
  const source = validatedSourceDirectory(workspaceRoot, sourceRoot);
  const overlays = new Map<string, string>();
  for (const changedPath of changedPaths) {
    const path = changedPath.replace(/\\/g, '/');
    if (!path || isAbsolute(path) || win32.isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.')) continue;
    if (!/\.[jt]sx?$/i.test(path) || /\.(?:d|spec|test)\.[jt]sx?$/i.test(path)) continue;
    const origin = join(source, path);
    try { overlays.set(origin, await readFile(origin, 'utf8')); }
    catch (error) { if (!['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }
  const results = new Map<string, ReturnType<typeof transformReactJsx>>();
  if (overlays.size) {
    const program = createSourceProgram(workspaceRoot, sourceRoot, overlays);
    for (const [origin, content] of overlays) {
      const transformed = transformReactJsx(content, origin, { program });
      const errors = transformed.diagnostics.filter(item => item.category === 'error');
      if (errors.length) throw new Error(formatReactJsxDiagnostics(content, origin, errors));
      results.set(origin, transformed);
    }
  }
  const registrationProgram = introspection && results.size
    ? createSourceProgram(workspaceRoot, sourceRoot, new Map([...results].map(([path, result]) => [path, result.code])))
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
  if (/\.[jt]sx?$/i.test(normalized) && !/\.(?:d|spec|test)\.[jt]sx?$/i.test(normalized)) {
    // Adoption and registration use the same authored snapshot for this batch.
    const transformed = batch.results.get(origin);
    if (!transformed) return; // A newly appearing file is handled by its next watch event.
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
    if (introspection && ENTRY_NAMES.includes(basename(normalized).toLowerCase())) code = injectIntrospectionActivation(code);
    await writeFileAtomic(destination, `${code}\n//# sourceMappingURL=${basename(destination)}.map\n`);
    await writeFileAtomic(`${destination}.map`, JSON.stringify(transformed.sourceMap));
  } else {
    await writeFileAtomic(destination, await readFile(origin));
  }
}

/** Share the semantic source graph with the Vite compiler, including imports. */
function createSourceProgram(
  workspaceRoot: string,
  sourceRoot: string,
  overlays = new Map<string, string>(),
): ts.Program {
  const source = join(workspaceRoot, sourceRoot);
  const sourceConfigPath = ts.findConfigFile(source, ts.sys.fileExists, "tsconfig.json");
  const workspaceConfigPath = ts.findConfigFile(workspaceRoot, ts.sys.fileExists, "tsconfig.json");
  const parseConfig = (configPath: string | undefined) => {
    const rawConfig = configPath ? (ts.readConfigFile(configPath, ts.sys.readFile).config ?? {}) : {};
    return configPath
      ? ts.parseJsonConfigFileContent(
          { ...rawConfig, compilerOptions: { ...(rawConfig.compilerOptions ?? {}), allowJs: true } },
          ts.sys, dirname(configPath), { jsx: ts.JsxEmit.Preserve }, configPath,
        )
      : { fileNames: [] as string[], options: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler } as ts.CompilerOptions };
  };
  // Solution-style app tsconfigs (`files: []` + project references) give the
  // checker no roots. Introspection then asks it about `this`/imports in files
  // it never loaded and crashes inside TypeScript. Fall back to the workspace
  // program, which owns the real source graph.
  let parsed = parseConfig(sourceConfigPath);
  if (parsed.fileNames.length === 0 && workspaceConfigPath && workspaceConfigPath !== sourceConfigPath) {
    parsed = parseConfig(workspaceConfigPath);
  }
  if (overlays.size === 0) {
    return ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, allowJs: true } });
  }
  // Overlay keys come from join() and keep platform separators, while the
  // program canonicalizes host paths to forward slashes (and Windows drive
  // casing varies). Index normalized paths once for the whole batch.
  const normalizedOverlays = new Map([...overlays].map(([path, text]) => [path.replace(/\\/g, '/').toLowerCase(), text]));
  const overlayFor = (fileName: string): string | undefined =>
    normalizedOverlays.get(fileName.replace(/\\/g, '/').toLowerCase());
  const host = ts.createCompilerHost({ ...parsed.options, allowJs: true });
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile?.bind(host);
  const fileExists = host.fileExists.bind(host);
  // TypeScript may ask for the same file more than once. Returning a fresh
  // SourceFile each time splits the nodes and symbols across instances and
  // corrupts the checker (observed as internal `escapedName`/`members` crashes
  // while instrumenting projects that do not import Streamix at all).
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
  return ts.createProgram({ rootNames: [...new Set([...parsed.fileNames, ...overlays.keys()])], options: { ...parsed.options, allowJs: true }, host });
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.js$/i.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
