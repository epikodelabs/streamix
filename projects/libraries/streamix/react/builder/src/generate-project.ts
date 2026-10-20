import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import ts from "typescript";
import { formatReactJsxDiagnostics, transformReactJsx } from "@epikodelabs/streamix/react/compiler";

export async function generateReactProject(workspaceRoot: string, sourceRoot: string, introspection = false): Promise<string> {
  const source = join(workspaceRoot, sourceRoot);
  const output = join(workspaceRoot, ".angular", ".streamix", virtualRootOf(sourceRoot));
  await rm(output, { recursive: true, force: true });
  await mkdir(dirname(output), { recursive: true });
  await cp(source, output, { recursive: true });

  const files = await collectAdoptableFiles(output);
  const program = createSourceProgram(workspaceRoot, sourceRoot);
  for (const file of files) {
    const original = join(source, relative(output, file));
    const input = await readFile(file, "utf8");
    const transformed = transformReactJsx(input, original, { program });
    const errors = transformed.diagnostics.filter(diagnostic => diagnostic.category === "error");
    if (errors.length > 0) {
      const relativeFile = relative(workspaceRoot, file);
      throw new Error(formatReactJsxDiagnostics(input, relativeFile, errors));
    }
    const mapName = `${basename(file)}.map`;
    await writeFile(file, `${transformed.code}\n//# sourceMappingURL=${mapName}\n`);
    await writeFile(join(dirname(file), mapName), `${JSON.stringify(transformed.sourceMap)}\n`);
  }
  const available = new Set((await readdir(output)).map(name => name.toLowerCase()));
  const entry = ENTRY_NAMES.find(name => available.has(name));
  if (introspection && entry !== undefined) {
    // Devtools activation is injected into the generated entry only, mirroring
    // the Angular builder: authored source stays clean and the gate stays
    // `import.meta.env.DEV`, so production builds carry inert definitions.
    await writeFile(join(output, entry), withIntrospection(await readFile(join(output, entry), "utf8")));
  }
  await writeFile(
    join(dirname(output), "tsconfig.app.json"),
    `${JSON.stringify({
      extends: toConfigPath(relative(dirname(output), join(workspaceRoot, "tsconfig.json"))),
      compilerOptions: { outDir: "../../out-tsc/app", types: [], jsx: "react-jsx", allowJs: true },
      files: entry ? [`src/${entry}`] : [],
      include: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.js", "src/**/*.jsx"],
      exclude: ["src/**/*.spec.*", "src/**/*.test.*", "src/**/*.d.ts"],
    }, null, 2)}\n`,
  );
  return output;
}

export function virtualRootOf(sourceRoot: string): string {
  return sourceRoot
    .replace(/^projects[\\/]apps[\\/]/, "")
    .replace(/[\\/]src$/, "/src");
}

const ENTRY_NAMES = ["main.tsx", "main.jsx", "main.ts", "main.js", "index.tsx", "index.jsx", "index.ts", "index.js"];

/** Inject devtools activation into a generated entry, matching the Angular builder's template. */
function withIntrospection(code: string): string {
  return `import { enableStreamixIntrospection as __sxEnable, mountStreamixInspector as __sxMount } from '@epikodelabs/streamix';\n__sxEnable();\n${code}\n__sxMount();\n`;
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

/** Synchronize an original source change into the delegated virtual project. */
export async function regenerateStreamixFile(workspaceRoot: string, sourceRoot: string, changedPath: string, introspection = false): Promise<void> {
  const originalRoot = join(workspaceRoot, sourceRoot);
  const destRoot = join(workspaceRoot, ".angular", ".streamix", virtualRootOf(sourceRoot));
  const normalized = changedPath.replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized.startsWith("/") || normalized.includes("/../")) return;
  const origin = join(originalRoot, normalized);
  const destination = join(destRoot, normalized);
  let content: string;
  try { content = await readFile(origin, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EISDIR") return;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await rm(destination, { force: true, recursive: true });
    await rm(`${destination}.map`, { force: true });
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  if (/\.[jt]sx?$/i.test(normalized) && !/\.(?:d|spec|test)\.[jt]sx?$/i.test(normalized)) {
    // The watcher can invoke us before an editor has flushed the buffer to
    // disk. Give semantic analysis the exact text being transformed instead
    // of silently checking an older SourceFile from disk.
    const transformed = transformReactJsx(content, origin, {
      program: createSourceProgram(workspaceRoot, sourceRoot, new Map([[origin, content]])),
    });
    const errors = transformed.diagnostics.filter(item => item.category === "error");
    if (errors.length) throw new Error(formatReactJsxDiagnostics(content, origin, errors));
    // A watch edit of the entry must keep the injected activation, or the
    // first save would silently drop introspection until the next full regen.
    const isEntry = introspection && ENTRY_NAMES.includes(basename(normalized).toLowerCase());
    const code = isEntry ? withIntrospection(transformed.code) : transformed.code;
    await writeFile(destination, `${code}\n//# sourceMappingURL=${basename(destination)}.map\n`);
    await writeFile(`${destination}.map`, JSON.stringify(transformed.sourceMap));
  } else {
    await writeFile(destination, await readFile(origin));
  }
}

/** Share the semantic source graph with the Vite compiler, including imports. */
function createSourceProgram(
  workspaceRoot: string,
  sourceRoot: string,
  overlays = new Map<string, string>(),
): ts.Program {
  const source = join(workspaceRoot, sourceRoot);
  const configPath = ts.findConfigFile(source, ts.sys.fileExists, "tsconfig.json") ??
    ts.findConfigFile(workspaceRoot, ts.sys.fileExists, "tsconfig.json");
  const rawConfig = configPath ? (ts.readConfigFile(configPath, ts.sys.readFile).config ?? {}) : {};
  const parsed = configPath
    ? ts.parseJsonConfigFileContent(
        { ...rawConfig, compilerOptions: { ...(rawConfig.compilerOptions ?? {}), allowJs: true } },
        ts.sys, dirname(configPath), { jsx: ts.JsxEmit.Preserve }, configPath,
      )
    : { fileNames: [], options: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler } as ts.CompilerOptions };
  if (overlays.size === 0) {
    return ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, allowJs: true } });
  }
  const host = ts.createCompilerHost({ ...parsed.options, allowJs: true });
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile?.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = overlays.get(fileName);
    if (text === undefined) return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    return ts.createSourceFile(fileName, text, languageVersion, true, scriptKindFor(fileName));
  };
  host.readFile = fileName => overlays.get(fileName) ?? readFile?.(fileName);
  host.fileExists = fileName => overlays.has(fileName) || fileExists(fileName);
  return ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, allowJs: true }, host });
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.js$/i.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
