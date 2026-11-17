import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { generateReactProject, regenerateReactFile } from "./generate-project";

/** Content snapshot of every file under a tree, keyed by slash-relative path. */
async function snapshotTree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files[relative(root, path).replace(/\\/g, "/")] = await readFile(path, "utf8");
    }
  };
  await walk(root);
  return files;
}

describe("React Angular-hosted source generation", () => {
  it("preserves semantic imported atom adoption and leaves spec TSX untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-builder-"));
    const sourceRoot = "projects/apps/demo/src";
    try {
      const source = join(root, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
        include: ["projects/apps/demo/src/**/*.ts", "projects/apps/demo/src/**/*.tsx"],
      }));
      await writeFile(join(source, "store.ts"), `
        export interface AtomLike<T> { readonly value: T; subscribe(callback: () => void): () => void; }
        export declare const status: AtomLike<string>;
      `);
      await writeFile(join(source, "main.tsx"), `
        import { status } from './store';
        export function App() { return <output>{status}</output>; }
      `);
      await writeFile(join(source, "helpers.ts"), `
        import { atom, derived } from '@epikodelabs/streamix';
        let count = atom(0);
        export const bump = () => count++;
        export const doubled = derived(() => count * 2);
      `);
      await writeFile(join(source, "Widget.jsx"), `
        import { atom } from '@epikodelabs/streamix';
        let count = atom(0);
        export function Widget() { return <button onClick={() => count++}>{count}</button>; }
      `);
      await writeFile(join(source, "main.spec.tsx"), `
        import { status } from './store';
        export function Test() { return <output>{status}</output>; }
      `);
      await mkdir(join(source, "assets"));
      const virtualRoot = await generateReactProject(root, sourceRoot);
      const compiled = await readFile(join(virtualRoot, "main.tsx"), "utf8");
      expect(compiled).toContain('useStreamixSource(status, "status")');
      const helper = await readFile(join(virtualRoot, "helpers.ts"), "utf8");
      expect(helper).toContain("count.next(");
      expect(helper).toContain("derived(() => count.value * 2)");
      const jsx = await readFile(join(virtualRoot, "Widget.jsx"), "utf8");
      expect(jsx).toContain("useStreamixSource(count");
      expect(jsx).not.toContain("as any");
      const testSource = await readFile(join(virtualRoot, "main.spec.tsx"), "utf8");
      expect(testSource).not.toContain("useStreamixSource");
      const config = JSON.parse(await readFile(join(root, ".angular/.streamix/demo/tsconfig.app.json"), "utf8"));
      expect(config.files).toEqual(["src/main.tsx"]);
      // The builder map chains through esbuild so devtools point at authored files.
      const map = JSON.parse(await readFile(join(virtualRoot, "main.tsx.map"), "utf8"));
      expect(map.version).toBe(3);
      expect(map.sources).toEqual(["projects/apps/demo/src/main.tsx"]);
      expect(map.sourcesContent[0]).toContain("export function App");
      expect(compiled.trimEnd().endsWith("//# sourceMappingURL=main.tsx.map")).toBe(true);
      await expectAsync(regenerateReactFile(root, sourceRoot, "assets")).toBeResolved();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("injects introspection activation into the generated entry only when enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-builder-introspect-"));
    const sourceRoot = "projects/apps/demo/src";
    try {
      const source = join(root, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
        include: ["projects/apps/demo/src/**/*.tsx"],
      }));
      const authored = `import { atom } from '@epikodelabs/streamix';\nexport const count = atom(0);\n`;
      await writeFile(join(source, "main.tsx"), authored);
      const generatedPath = join(root, ".angular/.streamix/demo/src/main.tsx");

      const virtualRoot = await generateReactProject(root, sourceRoot, true);
      const generated = await readFile(generatedPath, "utf8");
      expect(generated).toContain("__sxEnable();");
      expect(generated).toContain("__sxMount();");
      expect(generated).toContain("__sxDebug(atom(0)");
      expect(generated.indexOf("__sxEnable();")).toBeLessThan(generated.indexOf("export const count"));
      // Authored source stays clean: injection lives only in the generated tree.
      expect(await readFile(join(source, "main.tsx"), "utf8")).toBe(authored);

      // A watch edit of the entry must keep the activation.
      await regenerateReactFile(root, sourceRoot, "main.tsx", true);
      expect(await readFile(generatedPath, "utf8")).toContain("__sxEnable();");
      // Dropping the flag regenerates without it.
      await generateReactProject(root, sourceRoot, false);
      expect(await readFile(join(virtualRoot, "main.tsx"), "utf8")).not.toContain("__sxEnable");
      await regenerateReactFile(root, sourceRoot, "main.tsx", false);
      expect(await readFile(generatedPath, "utf8")).not.toContain("__sxEnable");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves previously generated project when a later source fails compilation", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-rollback-"));
    const sourceRoot = "projects/apps/demo/src";
    try {
      const source = join(root, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
        include: ["projects/apps/demo/src/**/*.ts", "projects/apps/demo/src/**/*.tsx"],
      }));
      await writeFile(join(source, "main.tsx"), `
        import { atom } from '@epikodelabs/streamix';
        let count = atom(0);
        export function Counter() { return <button onClick={() => count++}>{count}</button>; }
      `);
      await generateReactProject(root, sourceRoot);
      const before = await snapshotTree(join(root, ".angular"));
      await writeFile(join(source, "Broken.jsx"), `
        import { atom } from '@epikodelabs/streamix';
        const count = atom(0);
        export function Broken() { return <button onClick={() => count = 1}>{count}</button>; }
      `);
      await expectAsync(generateReactProject(root, sourceRoot)).toBeRejectedWithError(/read-only atom binding/);
      // The failed pass must not touch one byte of the served virtual tree.
      expect(await snapshotTree(join(root, ".angular"))).toEqual(before);
      const siblings = await readdir(join(root, ".angular/.streamix/demo"));
      expect(siblings.filter(name => name.includes("sx-stage") || name.includes("sx-backup"))).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("restores the committed virtual project when the post-swap tsconfig install fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-tsconfig-rollback-"));
    const sourceRoot = "projects/apps/demo/src";
    try {
      const source = join(root, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
        include: ["projects/apps/demo/src/**/*.ts", "projects/apps/demo/src/**/*.tsx"],
      }));
      await writeFile(join(source, "main.tsx"), `
        import { atom } from '@epikodelabs/streamix';
        let count = atom(0);
        export function Counter() { return <button onClick={() => count++}>{count}</button>; }
      `);
      const virtualRoot = await generateReactProject(root, sourceRoot);
      const before = await snapshotTree(virtualRoot);
      // The swap succeeds and only the virtual config install fails. An empty
      // directory at that path makes the final rename fail on every platform.
      const configPath = join(root, ".angular/.streamix/demo/tsconfig.app.json");
      await rm(configPath, { force: true });
      await mkdir(configPath);
      await writeFile(join(source, "main.tsx"), `
        import { atom } from '@epikodelabs/streamix';
        let count = atom(41);
        export function Counter() { return <button onClick={() => count++}>{count}</button>; }
      `);

      await expectAsync(generateReactProject(root, sourceRoot)).toBeRejected();

      // The uncommitted generation is discarded, never served.
      expect(await snapshotTree(virtualRoot)).toEqual(before);
      const siblings = await readdir(join(root, ".angular/.streamix/demo"));
      expect(siblings.filter(name => /sx-(?:stage|backup|tmp)/.test(name))).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reports the same authored path for full and watch regeneration errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-diagnostic-path-"));
    const sourceRoot = "projects/apps/demo/src";
    try {
      const source = join(root, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
        include: ["projects/apps/demo/src/**/*.ts", "projects/apps/demo/src/**/*.tsx"],
      }));
      await writeFile(join(source, "main.tsx"), `
        import { atom } from '@epikodelabs/streamix';
        let count = atom(0);
        export function Counter() { return <button onClick={() => count++}>{count}</button>; }
      `);
      await generateReactProject(root, sourceRoot);
      await writeFile(join(source, "Broken.tsx"), `
        import { atom } from '@epikodelabs/streamix';
        const count = atom(0);
        export function Broken() { return <button onClick={() => count = 1}>{count}</button>; }
      `);

      const capture = (promise: Promise<unknown>): Promise<Error> =>
        promise.then(() => { throw new Error("Expected regeneration to fail"); }, error => error as Error);
      const fullError = await capture(generateReactProject(root, sourceRoot));
      const watchError = await capture(regenerateReactFile(root, sourceRoot, "Broken.tsx"));

      const authored = `${relative(root, join(source, "Broken.tsx"))}:`;
      expect(fullError.message.startsWith(authored)).toBeTrue();
      expect(watchError.message.startsWith(authored)).toBeTrue();
      expect(watchError.message).toBe(fullError.message);
      expect(fullError.message).not.toContain(".angular/.streamix");
      expect(fullError.message).not.toContain(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects absolute and traversing source roots before modifying generated files", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-root-"));
    try {
      for (const invalid of ["", ".", "..", "../outside", "/tmp/source", "C:\\source", ".angular/source", "node_modules/x"]) {
        await expectAsync(generateReactProject(root, invalid)).toBeRejectedWithError(/sourceRoot/);
      }
      // Nothing was created for any rejected root.
      expect(await readdir(root)).not.toContain(".angular");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("recovers a tree abandoned by a crashed generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-crash-"));
    const sourceRoot = "projects/apps/demo/src";
    try {
      const source = join(root, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
        include: ["projects/apps/demo/src/**/*.ts", "projects/apps/demo/src/**/*.tsx"],
      }));
      await writeFile(join(source, "main.tsx"), `
        import { atom } from '@epikodelabs/streamix';
        let count = atom(0);
        export function Counter() { return <button onClick={() => count++}>{count}</button>; }
      `);
      await generateReactProject(root, sourceRoot);
      const before = await snapshotTree(join(root, ".angular"));
      // Simulate a crash between the backup and install renames: the live
      // tree is missing, the last good generation sits in an orphaned backup,
      // and a failed stage lingers beside it.
      const appDir = join(root, ".angular/.streamix/demo");
      await rename(join(appDir, "src"), join(appDir, ".src-sx-backup-11111111-2222-3333-4444-555555555555"));
      await mkdir(join(appDir, ".src-sx-stage-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), { recursive: true });
      await writeFile(join(source, "Broken.jsx"), `
        import { atom } from '@epikodelabs/streamix';
        const count = atom(0);
        export function Broken() { return <button onClick={() => count = 1}>{count}</button>; }
      `);
      await expectAsync(generateReactProject(root, sourceRoot)).toBeRejectedWithError(/read-only atom binding/);
      // The sweep restored the backup into the live tree and cleaned the
      // abandoned stage before the failing pass ran.
      expect(await snapshotTree(join(root, ".angular"))).toEqual(before);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("instruments a project with no Streamix sources and a solution-style app tsconfig", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-builder-plain-"));
    const sourceRoot = "projects/apps/demo/src";
    try {
      const source = join(root, sourceRoot);
      await mkdir(source, { recursive: true });
      // The app-level config has no roots; the builder must fall back to the
      // workspace program instead of handing instrumentation an empty checker.
      await writeFile(join(root, "projects/apps/demo/tsconfig.json"), JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.app.json" }],
      }));
      await writeFile(join(root, "projects/apps/demo/tsconfig.app.json"), JSON.stringify({
        files: ["src/main.tsx"],
        compilerOptions: { jsx: "react-jsx" },
      }));
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
        include: ["projects/apps/demo/src/**/*.ts", "projects/apps/demo/src/**/*.tsx"],
      }));
      const main = `export const App = () => <main>plain</main>;\n`;
      const helper = `export class Counter {\n  private value = 0;\n  increment() { return ++this.value; }\n}\n`;
      await writeFile(join(source, "main.tsx"), main);
      await writeFile(join(source, "helper.ts"), helper);
      const virtualRoot = await generateReactProject(root, sourceRoot, true);
      expect(await readFile(join(virtualRoot, "main.tsx"), "utf8")).toContain("__sxEnable();");
      expect(await readFile(join(virtualRoot, "helper.ts"), "utf8")).not.toContain("__sxDebug");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
