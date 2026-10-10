import { transformReactJsx } from "./compiler";
import ts from "typescript";

describe("Streamix React adoption regressions", () => {
  it("adopts arrow components and preserves local atom ownership without JSX reads", () => {
    const arrow = transformReactJsx(`const status = atom("Ready"); export const App = () => <div>{status}</div>;`);
    expect(arrow.bindingCount).toBe(1);
    expect(arrow.code).toContain('__streamixUse(status, "status")');
    const owner = transformReactJsx(`function Parent() { let count = atom(0); return <Child source={count}/>; }`);
    expect(owner.code).toContain("__streamixLocal(() => atom(0))");
  });

  it("does not corrupt property names, shadowing parameters, or const comparisons", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function View({obj, items}) {
        return <main>{obj.count}{items.map(count => <span>{count}</span>)}
          <button onClick={() => { if (count === 0) done(); }}>{count}</button>
        </main>;
      }
    `);
    expect(result.diagnostics.filter(d => d.category === "error")).toEqual([]);
    expect(result.code).toContain("obj.count");
    expect(result.code).toContain("items.map(count => <span>{count}</span>)");
    expect(result.code).not.toContain("obj.__streamixBinding");
  });

  it("does not adopt foreign imports as Streamix factories", () => {
    const result = transformReactJsx(`import { flow } from "lodash"; const pipeline = flow(f, g); function View() { return <b>{pipeline(1)}</b>; }`);
    expect(result.bindingCount).toBe(0);
  });

  it("recognizes imported factory aliases", () => {
    const result = transformReactJsx(`import { atom as writable } from "@epikodelabs/streamix"; const value = writable(1); function View() { return <b>{value}</b>; }`);
    expect(result.bindingCount).toBe(1);
  });

  it("preserves the use client directive at the start of the module", () => {
    const result = transformReactJsx(`"use client"; const status = atom(1); function View() { return <b>{status}</b>; }`);
    expect(result.code.trimStart().startsWith('"use client";')).toBe(true);
  });

  it("rejects local reactive declarations after a possible early return", () => {
    const result = transformReactJsx(`
      function App({ enabled }: { enabled: boolean }) {
        if (!enabled) return null;
        const count = atom(0);
        return <output>{count}</output>;
      }
    `);
    expect(result.diagnostics.some(diagnostic => diagnostic.category === "error" && diagnostic.message.includes("after a possible return"))).toBe(true);
    expect(result.code).not.toContain("__streamixLocal");
  });

  it("uses a host TypeScript program to refuse same-named non-Streamix factories", () => {
    const fileName = "/workspace/Counter.tsx";
    const source = `
      const atom = (value: number) => ({ value });
      const count = atom(0);
      export function Counter() { return <span>{count}</span>; }
    `;
    const host: ts.CompilerHost = {
      getSourceFile: name => name === fileName
        ? ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        : undefined,
      getDefaultLibFileName: () => "",
      writeFile: () => undefined,
      getCurrentDirectory: () => "/workspace",
      getCanonicalFileName: name => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: name => name === fileName,
      readFile: name => name === fileName ? source : undefined,
      getDirectories: () => [],
    };
    const program = ts.createProgram([fileName], { jsx: ts.JsxEmit.Preserve, noLib: true }, host);

    const result = transformReactJsx(source, fileName, { program });
    expect(result.bindingCount).toBe(0);
    expect(result.code).not.toContain("__streamixUse");
  });
});
