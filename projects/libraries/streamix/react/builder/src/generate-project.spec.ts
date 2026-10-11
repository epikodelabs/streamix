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
});
