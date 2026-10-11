import { transformReactJsx } from "./compiler";
import ts from "typescript";

describe("Streamix React adoption regressions", () => {
  it("adopts arrow components and preserves local atom ownership without JSX reads", () => {
    const arrow = transformReactJsx(`const status = atom("Ready"); export const App = () => <div>{status}</div>;`);
    expect(arrow.bindingCount).toBe(1);
    expect(arrow.code).toContain('useStreamixSource(status, "status")');
    const owner = transformReactJsx(`function Parent() { let count = atom(0); return <Child source={count}/>; }`);
    expect(owner.code).toContain("useStreamixLocal(() => atom(0))");
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
    expect(result.code).not.toContain("useStreamixLocal");
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
    expect(result.code).not.toContain("useStreamixSource");
  });

  it("lowers every supported compound write instead of assigning to the atom object", () => {
    const result = transformReactJsx(`
      let count = atom(2);
      let flag = atom(true);
      let guess = atom(0);
      export function Counter() {
        count **= 3;
        count <<= 1;
        count >>= 1;
        count >>>= 1;
        count *= 4;
        count &&= flag;
        count ||= guess;
        count ??= guess;
        return <output>{count}</output>;
      }
    `);

    expect(result.diagnostics.filter(d => d.category === "error")).toEqual([]);
    expect(result.code).toContain("count.next(count.value ** 3)");
    expect(result.code).toContain("count.next(count.value << 1)");
    expect(result.code).toContain("count.next(count.value >> 1)");
    expect(result.code).toContain("count.next(count.value >>> 1)");
    expect(result.code).toContain("count.next(count.value * 4)");
    expect(result.code).toContain("count.next(flag.value)");
    // Short-circuit writes only assign when the operator's condition holds.
    expect(result.code).toContain("const __streamixCurrent");
    expect((result.code.match(/const __streamixCurrent/g) ?? []).length).toBe(3);
    expect(result.code).toContain("if (__streamixCurrent");
    expect(result.code).toContain("!__streamixCurrent");
    expect(result.code).toContain("=== null ||");
    expect(result.code).toContain("=== undefined");
  });

  it("lowers explicit .value reads in JSX without producing a second .value", () => {
    const result = transformReactJsx(`
      let count = atom(2);
      const model = { count };
      export function Counter({ k }: { k: string }) {
        count = count.value + 1;
        return <output title={count.value.toFixed(2)}>{model[k].value}{model.count.value}</output>;
      }
    `);

    expect(result.diagnostics.filter(d => d.category === "error")).toEqual([]);
    expect(result.code).toContain("count.next(count.value + 1)");
    expect(result.code).toContain('useStreamixSource(model[k] as any, "model[k]")');
    expect(result.code).toContain('useStreamixSource(count, "count")');
    expect(result.code).not.toContain(".value.value");
    expect(result.code).toContain(".toFixed(2)");
  });

  it("keeps generated hooks before a possible return even with unrelated locals", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      export function Counter({ open }: { open: boolean }) {
        const label = "counter";
        if (!open) return null;
        const detail = "static";
        return <output data-label={label}>{count}</output>;
      }
    `);

    expect(result.diagnostics.filter(d => d.category === "error")).toEqual([]);
    const hookIndex = result.code.indexOf("useStreamixSource(count");
    const returnIndex = result.code.indexOf("if (!open)");
    expect(hookIndex).toBeGreaterThan(-1);
    expect(returnIndex).toBeGreaterThan(-1);
    expect(hookIndex).toBeLessThan(returnIndex);
  });

  it("reports a reactive binding that can only be initialized after a possible return", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      export function Counter({ open }: { open: boolean }) {
        if (!open) return null;
        const alias = count;
        return <output>{alias}</output>;
      }
    `);

    expect(result.diagnostics.some(d => d.category === "error" && d.message.includes("would run conditionally"))).toBe(true);
  });

  it("keeps heterogeneous dynamic selections type-agnostic at the generated call", () => {
    const result = transformReactJsx(`
      const title = atom("Ready");
      const count = atom(0);
      const model = { title, count };
      export function View({ key }: { key: string }) {
        return <output>{model[key]}</output>;
      }
    `);

    expect(result.diagnostics.filter(d => d.category === "error")).toEqual([]);
    expect(result.code).toContain("useStreamixSource(model[key] as any, \"model[key]\")");
  });

  it("traces committed renders for arrow and memo components under their declared name", () => {
    const arrow = transformReactJsx(`const status = atom("Ready"); export const App = () => <div>{status}</div>;`);
    expect(arrow.code).toContain('__streamixTrace("render", "App")');

    const memo = transformReactJsx(`
      import { memo } from "react";
      const status = atom("Ready");
      export const App = memo(() => <div>{status}</div>);
    `);
    expect(memo.code).toContain('__streamixTrace("render", "App")');
  });
});
