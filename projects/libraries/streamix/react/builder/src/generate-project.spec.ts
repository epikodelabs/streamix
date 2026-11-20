import { mkdtemp, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
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
      expect(generated).toContain("introspection/activate");
      expect(generated).toContain("__sxMount();");
      expect(generated).toContain("__sxDebug(atom(0)");
      expect(generated.indexOf("introspection/activate")).toBeLessThan(generated.indexOf("export const count"));
      const fullMap = await readFile(`${generatedPath}.map`, "utf8");
      expect(JSON.parse(fullMap).sources).toEqual([`${sourceRoot}/main.tsx`]);
      expect(JSON.parse(fullMap).sourcesContent).toEqual([authored]);
      // Authored source stays clean: injection lives only in the generated tree.
      expect(await readFile(join(source, "main.tsx"), "utf8")).toBe(authored);

      // A watch edit of the entry must keep the activation.
      await regenerateReactFile(root, sourceRoot, "main.tsx", true);
      expect(await readFile(generatedPath, "utf8")).toBe(generated);
      expect(await readFile(`${generatedPath}.map`, "utf8")).toBe(fullMap);
      // Dropping the flag regenerates without it.
      await generateReactProject(root, sourceRoot, false);
      expect(await readFile(join(virtualRoot, "main.tsx"), "utf8")).not.toContain("introspection/activate");
      await regenerateReactFile(root, sourceRoot, "main.tsx", false);
      expect(await readFile(generatedPath, "utf8")).not.toContain("introspection/activate");
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

  it("reports every failing file and keeps warnings beside contract errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-aggregate-"));
    const sourceRoot = "projects/apps/demo/src";
    try {
      const source = join(root, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
        include: ["projects/apps/demo/src/**/*.ts", "projects/apps/demo/src/**/*.tsx"],
      }));
      const broken = (name: string) => `
        import { atom } from '@epikodelabs/streamix';
        const locked = atom(0);
        export function ${name}() { locked = 1; return <output>{locked}</output>; }
      `;
      await writeFile(join(source, "First.tsx"), broken("First"));
      await writeFile(join(source, "Second.tsx"), broken("Second"));
      await writeFile(join(source, "Mixed.tsx"), `
        import { atom } from '@epikodelabs/streamix';
        let a = atom(0);
        let plain = 0;
        const locked = atom(0);
        export function Mixed() {
          ({ a, plain } = { a: 1, plain: 2 });
          locked = 3;
          return <output>{a}{plain}{locked}</output>;
        }
      `);

      const error = await generateReactProject(root, sourceRoot)
        .then(() => { throw new Error("Expected generation to fail"); }, (reason: unknown) => reason as Error);
      const authored = (name: string) => `${relative(root, join(source, name))}:`;
      expect(error.message).toContain(authored("First.tsx"));
      expect(error.message).toContain(authored("Second.tsx"));
      expect(error.message).toContain(authored("Mixed.tsx"));
      expect(error.message).toContain("read-only atom binding");
      expect(error.message).toContain("Mixed destructured atom assignment");
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
      expect(await readFile(join(virtualRoot, "main.tsx"), "utf8")).toContain("introspection/activate");
      expect(await readFile(join(virtualRoot, "helper.ts"), "utf8")).not.toContain("__sxDebug");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("mirrors authored deletions by removing the generated twin and its map", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-builder-delete-"));
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
        export function App() { return <button onClick={() => count++}>{count}</button>; }
      `);
      await writeFile(join(source, "extra.ts"), `
        import { atom } from '@epikodelabs/streamix';
        export const keep = atom(1);
      `);
      const virtualRoot = await generateReactProject(root, sourceRoot);
      const virtualExtra = join(virtualRoot, "extra.ts");
      await readFile(virtualExtra, "utf8");

      // Deleting the authored source removes its virtual twin and map, so the
      // delegated build never resolves a stale module.
      await rm(join(source, "extra.ts"));
      await regenerateReactFile(root, sourceRoot, "extra.ts");
      await expectAsync(readFile(virtualExtra, "utf8")).toBeRejected();
      await expectAsync(readFile(`${virtualExtra}.map`, "utf8")).toBeRejected();

      // Siblings stay untouched.
      expect(await readFile(join(virtualRoot, "main.tsx"), "utf8")).toContain("useStreamixSource");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("React builder watch recovery and work", () => {
  const writeTsconfig = async (root: string): Promise<void> => {
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
      include: ["projects/apps/demo/src/**/*.ts", "projects/apps/demo/src/**/*.tsx"],
    }));
  };

  it("restores a backup-only tree when the next generation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-recovery-"));
    const sourceRoot = "projects/apps/demo/src";
    const source = join(root, sourceRoot);
    try {
      await mkdir(source, { recursive: true });
      await writeTsconfig(root);
      await writeFile(join(source, "main.tsx"), `
        export function App() { return <output>ready</output>; }
      `);
      const output = await generateReactProject(root, sourceRoot);
      const before = await snapshotTree(output);

      const backup = join(dirname(output), `.${basename(output)}-sx-backup-${randomUUID()}`);
      await rename(output, backup);
      await writeFile(join(source, "broken.tsx"), `
        import { atom } from "@epikodelabs/streamix";
        export function Broken({ flag }: { flag: boolean }) {
          if (flag) return null;
          const count = atom(0);
          return <output>{count}</output>;
        }
      `);

      await expectAsync(generateReactProject(root, sourceRoot)).toBeRejected();
      expect(await snapshotTree(output)).toEqual(before);
      expect((await readdir(dirname(output))).some(name => name.includes("-sx-backup-"))).toBeFalse();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not rewrite an unchanged TypeScript file during a watch cycle", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-unchanged-"));
    const sourceRoot = "projects/apps/demo/src";
    const source = join(root, sourceRoot);
    try {
      await mkdir(source, { recursive: true });
      await writeTsconfig(root);
      await writeFile(join(source, "plain.tsx"), `
        export const value = 1;
        export function Plain() { return <span />; }
      `);
      const output = await generateReactProject(root, sourceRoot);
      const destination = join(output, "plain.tsx");
      const past = new Date("2000-01-01T00:00:00Z");
      await utimes(destination, past, past);
      await utimes(`${destination}.map`, past, past);

      await regenerateReactFile(root, sourceRoot, "plain.tsx");

      expect((await stat(destination)).mtimeMs).toBeLessThan(Date.parse("2001-01-01T00:00:00Z"));
      expect((await stat(`${destination}.map`)).mtimeMs).toBeLessThan(Date.parse("2001-01-01T00:00:00Z"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Streamix React builder schema", () => {
  it("declares the introspection and watch options", async () => {
    const { readFile } = await import("node:fs/promises");
    const schema = JSON.parse(
      await readFile("projects/libraries/streamix/react/builder/schema.json", "utf8"),
    );

    expect(schema.properties.introspection.type).toBe("boolean");
    expect(schema.properties.watch.type).toBe("boolean");
    expect(schema.required).toEqual(["delegateTarget", "sourceRoot"]);
  });
});
