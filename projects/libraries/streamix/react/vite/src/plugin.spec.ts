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

  it("skips non-JSX and node_modules modules", () => {
    const plugin = sx();
    const context = { error: (message: string): never => { throw new Error(message); } } as any;

    expect(transformOf(plugin).call(context, "export const count = 0;", "/workspace/src/value.ts")).toBeNull();
    expect(transformOf(plugin).call(context, "export const count = 0;", "/workspace/node_modules/lib/index.tsx")).toBeNull();
  });
});

function transformOf(plugin: ReturnType<typeof sx>): (source: string, id: string) => unknown {
  const transform = plugin.transform!;
  return (typeof transform === "function" ? transform : transform.handler) as (source: string, id: string) => unknown;
}
