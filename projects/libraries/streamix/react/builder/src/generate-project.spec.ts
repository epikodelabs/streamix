import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateReactProject, regenerateStreamixFile } from "./generate-project";

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
      await expectAsync(regenerateStreamixFile(root, sourceRoot, "assets")).toBeResolved();
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
      await regenerateStreamixFile(root, sourceRoot, "main.tsx", true);
      expect(await readFile(generatedPath, "utf8")).toContain("__sxEnable();");
      // Dropping the flag regenerates without it.
      await generateReactProject(root, sourceRoot, false);
      expect(await readFile(join(virtualRoot, "main.tsx"), "utf8")).not.toContain("__sxEnable");
      await regenerateStreamixFile(root, sourceRoot, "main.tsx", false);
      expect(await readFile(generatedPath, "utf8")).not.toContain("__sxEnable");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
