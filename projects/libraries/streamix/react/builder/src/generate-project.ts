import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { formatReactJsxDiagnostics, transformReactJsx } from "@epikodelabs/streamix/react/compiler";

export async function generateReactProject(workspaceRoot: string, sourceRoot: string): Promise<string> {
  const source = join(workspaceRoot, sourceRoot);
  const output = join(workspaceRoot, ".angular", ".streamix", virtualRootOf(sourceRoot));
  await rm(output, { recursive: true, force: true });
  await mkdir(dirname(output), { recursive: true });
  await cp(source, output, { recursive: true });

  const files = await collectTsxFiles(output);
  for (const file of files) {
    const input = await readFile(file, "utf8");
    const transformed = transformReactJsx(input, relative(workspaceRoot, file));
    const errors = transformed.diagnostics.filter(diagnostic => diagnostic.category === "error");
    if (errors.length > 0) {
      const relativeFile = relative(workspaceRoot, file);
      throw new Error(formatReactJsxDiagnostics(input, relativeFile, errors));
    }
    const mapName = `${basename(file)}.map`;
    await writeFile(file, `${transformed.code}\n//# sourceMappingURL=${mapName}\n`);
    await writeFile(join(dirname(file), mapName), `${JSON.stringify(transformed.sourceMap)}\n`);
  }
  await writeFile(
    join(dirname(output), "tsconfig.app.json"),
    `${JSON.stringify({
      extends: toConfigPath(relative(dirname(output), join(workspaceRoot, "tsconfig.json"))),
      compilerOptions: { outDir: "../../out-tsc/app", types: [], jsx: "react-jsx" },
      files: ["src/main.tsx"],
      include: ["src/**/*.d.ts"],
    }, null, 2)}\n`,
  );
  return output;
}

function virtualRootOf(sourceRoot: string): string {
  return sourceRoot
    .replace(/^projects[\\/]apps[\\/]/, "")
    .replace(/[\\/]src$/, "/src");
}

function toConfigPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

async function collectTsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTsxFiles(path));
    else if (entry.isFile() && path.endsWith(".tsx") && !path.endsWith(".d.tsx")) files.push(path);
  }
  return files;
}
