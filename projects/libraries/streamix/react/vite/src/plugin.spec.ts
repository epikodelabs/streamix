import { sx } from "./plugin";

describe("Streamix React Vite plugin", () => {
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

  it("adopts plain TypeScript modules that import Streamix", () => {
    const plugin = sx();
    const context = { error: (message: string): never => { throw new Error(message); } } as any;

    const transformed = transformOf(plugin).call(context,
      `import { atom } from "@epikodelabs/streamix";\nexport const total = atom(1);`,
      "/workspace/src/store.ts") as { code: string };
    expect(transformed.code).toContain("@epikodelabs/streamix");
  });

  it("builds with the inspector when introspection is on and completely without otherwise", () => {
    const context = { error: (message: string): never => { throw new Error(message); } } as any;
    const source = `import { atom } from "@epikodelabs/streamix";\nexport const count = atom(0);`;
    const entry = "/workspace/src/main.tsx";

    const on = sx({ introspection: true });
    const define = (on.config as any)?.call(on, {}, { command: "build" });
    expect(define.define["import.meta.env.DEV"]).toBe("true");
    const enabled = transformOf(on).call(context, source, entry) as { code: string };
    expect(enabled.code).toContain("__sxEnable();");
    expect(enabled.code).toContain("__sxMount();");
    expect(enabled.code).toContain("__sxDebug(atom(0)");

    const off = sx();
    expect((off.config as any)?.call(off, {}, { command: "build" })).toBeUndefined();
    const plain = transformOf(off).call(context, source, entry) as { code: string };
    expect(plain.code).not.toContain("__sxEnable");
    expect(plain.code).not.toContain("__sxDebug");
  });
});

function transformOf(plugin: ReturnType<typeof sx>): (source: string, id: string) => unknown {
  const transform = plugin.transform!;
  return (typeof transform === "function" ? transform : transform.handler) as (source: string, id: string) => unknown;
}
