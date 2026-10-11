import ts from "typescript";
import { transformReactJsx } from "./compiler";

describe("React production gates", () => {
  it("adopts class-component implicit atom and scope reads through a function boundary", () => {
    const source = `import { atom, scope } from '@epikodelabs/streamix'; const count = atom(1); const state = scope({ title: "Ready" }); class Counter extends React.Component { render() { return <output>{count} {state.title}</output>; } }`;
    const result = transformReactJsx(source);
    expect(result.diagnostics.filter(d => d.category === "error")).toEqual([]);
    expect(result.bindingCount).toBe(2);
    expect(result.code).toContain("class __StreamixCounter extends React.Component");
    expect(result.code).toContain('this.props as any).__streamixBindings["count"]');
    expect(result.code).toContain('this.props as any).__streamixBindings["state.title"]');
    expect(result.code).toContain('useStreamixSource(count, "count")');
    expect(result.code).toContain('useStreamixSource(state.get("title"), "state.title")');
    expect(result.code).toContain("const __streamixClassBinding0 = useStreamixSource(count");
    expect(result.code).toContain("__streamixBindings={{ count: __streamixClassBinding0");
    expect(result.code).toContain("function Counter(props: any)");
  });

  it("does not reject classes merely mentioning a reactive name in text or explicit transport", () => {
    const source = `import { atom } from '@epikodelabs/streamix'; const count = atom(1); class Notes { title = "count"; message() { return "count"; } }`;
    const result = transformReactJsx(source);
    expect(result.diagnostics).toEqual([]);
  });

  it("adopts anonymous default exports with module and component-local sources", () => {
    const shared = transformReactJsx(`import {atom} from '@epikodelabs/streamix';const status=atom('ready');export default () => <output>{status}</output>;`);
    expect(shared.diagnostics.filter(d => d.category === "error")).toEqual([]);
    expect(shared.code).toContain('useStreamixSource(status, "status")');
    const local = transformReactJsx(`import {atom} from '@epikodelabs/streamix';export default function(){let count=atom(0); return <button>{count}</button>;}`);
    expect(local.diagnostics.filter(d => d.category === "error")).toEqual([]);
    expect(local.code).toContain('useStreamixLocal(() => atom(0))');
  });

  it("adopts React and application higher-order wrappers", () => {
    const named = transformReactJsx(`import { memo as m, forwardRef as ref } from "react";const count=atom(0);export const A=m(()=> <i>{count}</i>);export const B=ref((_props, _r)=> <b>{count}</b>);`);
    expect(named.diagnostics).toEqual([]);
    expect(named.bindingCount).toBe(2);
    const namespace = transformReactJsx(`import * as React from "react";const count=atom(0);export const A=React.memo(()=> <i>{count}</i>);`);
    expect(namespace.bindingCount).toBe(1);
    const unsupported = transformReactJsx(`const count=atom(0);const state=scope({ title: "Ready" });const foreign={memo:(fn)=>fn};export const A=foreign.memo(()=> <i>{count}</i>);export const B=foreign.memo(()=> <i>{state.title}</i>);`);
    expect(unsupported.diagnostics.filter(d => d.category === "error")).toEqual([]);
    expect(unsupported.bindingCount).toBe(2);
    expect(unsupported.code).toContain('useStreamixSource(count, "count")');
    expect(unsupported.code).toContain('useStreamixSource(state.get("title"), "state.title")');
  });

  it("resolves shadowed Streamix factory calls through a TypeScript Program", () => {
    const fileName = "/virtual/App.tsx";
    const source = `import { atom } from '@epikodelabs/streamix'; export function App(){ const atom = (v:number) => ({ value:v }); const fake = atom(2); return <output>{fake.value}</output>; }`;
    const options: ts.CompilerOptions = { noLib: true, jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext };
    const host = ts.createCompilerHost(options);
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    host.getSourceFile = name => name === fileName ? sourceFile : undefined;
    host.fileExists = name => name === fileName;
    host.readFile = name => name === fileName ? source : undefined;
    const program = ts.createProgram([fileName], options, host);
    const result = transformReactJsx(source, fileName, { program });
    expect(result.bindingCount).toBe(0);
    expect(result.code).not.toContain("useStreamixSource(fake");
  });
});
