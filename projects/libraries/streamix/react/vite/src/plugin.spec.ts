import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { sx } from "./plugin";

describe("Streamix React Vite plugin", () => {
  it('reports malformed tsconfigs before compiling authored modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'streamix-react-bad-config-'));
    try {
      await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"module":"bogus"}}');
      const transform = transformOf(sx({ introspection: true }));
      const source = "import { atom } from '@epikodelabs/streamix'; export const count = atom(0);";
      expect(() => transform.call({}, source, join(root, 'store.ts')))
        .toThrowError(/tsconfig\.json:[\s\S]*--module/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
  it("transforms authored TSX before Vite's React plugin and returns a source map", () => {
    const plugin = sx();
    const transformed = transformOf(plugin).call(
      { error: (message: string): never => { throw new Error(message); } } as any,
      `const count = atom(0); export function Counter() { return <span>{count}</span>; }`,
      "/workspace/src/Counter.tsx",
    ) as { code: string; map: { sources: readonly string[] } };

    expect(transformed.code).toContain('useStreamixSource(count, "count")');
    expect(transformed.map.sources).toEqual(["/workspace/src/Counter.tsx"]);
  });

  it("skips plain modules without JSX or a Streamix import, and node_modules", () => {
    const plugin = sx();
    const context = { error: (message: string): never => { throw new Error(message); } } as any;

    expect(transformOf(plugin).call(context, "export const count = 0;", "/workspace/src/value.ts")).toBeNull();
    expect(transformOf(plugin).call(context, "export const count = 0;", "/workspace/node_modules/lib/index.tsx")).toBeNull();
  });

  it("does not build a program for comparisons or type assertions without JSX", () => {
    const plugin = sx();
    const context = { error: (message: string): never => { throw new Error(message); } } as any;
    const readFile = spyOn(ts.sys, "readFile").and.callThrough();

    expect(transformOf(plugin).call(context,
      "export const ok = left < right && low > high;",
      "/workspace/src/comparison.ts")).toBeNull();
    expect(transformOf(plugin).call(context,
      "export type Box = Foo<number>; export const value = <Foo>input;",
      "/workspace/src/generic.ts")).toBeNull();
    expect(transformOf(plugin).call(context,
      "export const ok = left < right && low > high;",
      "/workspace/src/comparison.tsx")).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reports warnings and contract errors for the same module", () => {
    const plugin = sx();
    const warnings: string[] = [];
    const errors: string[] = [];
    const context = {
      warn: (message: string) => { warnings.push(message); },
      error: (message: string): never => { errors.push(message); throw new Error(message); },
    } as any;
    const source = `
      import { atom } from "@epikodelabs/streamix";
      let a = atom(0);
      let plain = 0;
      const locked = atom(0);
      export function Mixed() {
        ({ a, plain } = { a: 1, plain: 2 });
        locked = 1;
        return <output>{a}{plain}{locked}</output>;
      }
    `;

    expect(() => transformOf(plugin).call(context, source, "/workspace/src/Mixed.tsx"))
      .toThrowError(/read-only atom binding/);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("Mixed destructured");
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("read-only atom binding");
  });

  it("adopts plain TypeScript modules that import Streamix", () => {
    const plugin = sx();
    const context = { error: (message: string): never => { throw new Error(message); } } as any;

    const transformed = transformOf(plugin).call(context,
      `import { atom } from "@epikodelabs/streamix";\nexport const total = atom(1);`,
      "/workspace/src/store.ts") as { code: string };
    expect(transformed.code).toContain("@epikodelabs/streamix");
  });

  it("invalidates only the cached program that contains the edited source", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-vite-watch-"));
    try {
      const projectA = join(root, "a");
      const projectB = join(root, "b");
      await mkdir(projectA, { recursive: true });
      await mkdir(projectB, { recursive: true });
      const config = JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
        include: ["*.ts"],
      });
      await writeFile(join(projectA, "tsconfig.json"), config);
      await writeFile(join(projectB, "tsconfig.json"), config);
      const fileA = join(projectA, "a.ts");
      const fileB = join(projectB, "b.ts");
      const originalA = `import { atom } from "@epikodelabs/streamix";\nexport const count = atom(0);`;
      const sourceB = `import { atom } from "@epikodelabs/streamix";\nexport const title = atom("b");`;
      await writeFile(fileA, originalA);
      await writeFile(fileB, sourceB);

      const plugin = sx();
      const context = { error: (message: string): never => { throw new Error(message); } } as any;
      const transform = (source: string, path: string) => transformOf(plugin).call(context, source, path) as { code: string };
      const watchChange = watchChangeOf(plugin);

      transform(originalA, fileA);
      transform(sourceB, fileB);

      const readFileSpy = spyOn(ts.sys, "readFile").and.callThrough();
      const editedA = `import { atom } from "@epikodelabs/streamix";\nexport const count = atom(1);`;
      await writeFile(fileA, editedA);
      watchChange(fileA, { event: "update" });

      readFileSpy.calls.reset();
      transform(editedA, fileA); // A rebuilds: config plus source reads
      const rebuildReads = readFileSpy.calls.count();

      readFileSpy.calls.reset();
      transform(sourceB, fileB); // B stays cached: only its config is read
      const cachedReads = readFileSpy.calls.count();
      readFileSpy.and.callThrough();

      expect(rebuildReads).toBeGreaterThan(1);
      expect(cachedReads).toBe(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rebuilds a project after a dependency edit changes symbol identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-react-vite-dependency-"));
    try {
      const app = join(root, "app#workspace");
      await mkdir(app, { recursive: true });
      await writeFile(join(app, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
        include: ["*.ts", "*.tsx"],
      }));
      const dependency = join(app, "dep.ts");
      await writeFile(dependency, `
        export interface AtomLike<T> { readonly value: T; subscribe(callback: () => void): () => void; }
        export declare const status: AtomLike<string>;
      `);
      const view = join(app, "view.tsx");
      const viewSource = `import { status } from "./dep";\nexport function App() { return <output>{status}</output>; }`;
      await writeFile(view, viewSource);

      const plugin = sx();
      const context = { error: (message: string): never => { throw new Error(message); } } as any;
      const transform = (source: string, path: string) => transformOf(plugin).call(context, source, path) as { code: string };
      const watchChange = watchChangeOf(plugin);

      const adopted = transform(viewSource, `${view}?react-refresh`);
      expect(adopted.code).toContain('useStreamixSource(status, "status")');

      // The dependency is no longer structurally reactive.
      await writeFile(dependency, `export declare const status: string;`);
      watchChange(`${dependency}#watch`, { event: "update" });
      const plain = transform(viewSource, view);
      expect(plain.code).not.toContain("useStreamixSource");
      expect(plain.code).not.toContain("@epikodelabs/streamix/react");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("builds with the inspector when introspection is on and completely without otherwise", () => {
    const context = { error: (message: string): never => { throw new Error(message); } } as any;
    const source = `import { atom } from "@epikodelabs/streamix";\nexport const count = atom(0);`;
    const entry = "/workspace/src/main.tsx";

    const on = sx({ introspection: true });
    const define = (on.config as any)?.call(on, {}, { command: "build" });
    expect(define.define["import.meta.env.DEV"]).toBe("true");
    const enabled = transformOf(on).call(context, source, entry) as {
      code: string; map: ConstructorParameters<typeof SourceMap>[0];
    };
    expect(enabled.code).toContain("import '@epikodelabs/streamix/introspection/activate';");
    expect(enabled.code).toContain("__sxMount();");
    expect(enabled.code).toContain("__sxDebug(atom(0)");
    expect(enabled.map.sourcesContent).toEqual([source]);
    const beforeCount = enabled.code.slice(0, enabled.code.indexOf("const count") + "const ".length).split("\n");
    const location = new SourceMap(enabled.map).findEntry(beforeCount.length - 1, beforeCount.at(-1)!.length);
    expect(location).toEqual(jasmine.objectContaining({ originalLine: 1, originalColumn: "export const ".length }));

    const off = sx();
    expect((off.config as any)?.call(off, {}, { command: "build" })).toBeUndefined();
    const plain = transformOf(off).call(context, source, entry) as { code: string };
    expect(plain.code).not.toContain('introspection/activate');
    expect(plain.code).not.toContain("__sxDebug");
  });

  it("activates the inspector in a plain entry without loading a semantic program", () => {
    const source = 'import "./bootstrap";';
    const entry = "/workspace/src/main.ts";
    const readFile = spyOn(ts.sys, "readFile").and.callThrough();
    const transformed = transformOf(sx({ introspection: true }))(source, entry) as {
      code: string; map: { sourcesContent: string[] };
    };
    expect(transformed.code).toContain("introspection/activate");
    expect(transformed.map.sourcesContent).toEqual([source]);
    expect(transformOf(sx())(source, entry)).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects wrapped asynchronous formulas before Vite handles TypeScript", () => {
    const context = { error: (message: string): never => { throw new Error(message); } };
    const source = `
      import { derived } from "@epikodelabs/streamix";
      derived(((async () => 2) as () => Promise<number>)!);
    `;
    expect(() => transformOf(sx()).call(context, source, "/workspace/src/AsyncFormula.ts"))
      .toThrowError(/AsyncFormula\.ts:\d+:\d+[\s\S]*synchronously/);
  });
});

function transformOf(plugin: ReturnType<typeof sx>): (source: string, id: string) => unknown {
  const transform = plugin.transform!;
  return (typeof transform === "function" ? transform : transform.handler) as (source: string, id: string) => unknown;
}

function watchChangeOf(plugin: ReturnType<typeof sx>): (id: string, change: { event: "create" | "update" | "delete" }) => unknown {
  const watchChange = plugin.watchChange!;
  return (typeof watchChange === "function" ? watchChange : watchChange.handler) as
    (id: string, change: { event: "create" | "update" | "delete" }) => unknown;
}
