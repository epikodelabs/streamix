import ts from "typescript";
import { transformReactJsx } from "./compiler";

describe("React production gates", () => {
  it("rejects class-component implicit reads with a build-breaking error", () => {
    const source = `import { atom } from '@epikodelabs/streamix'; const count = atom(1); class Counter extends React.Component { render() { return <output>{count}</output>; } }`;
    const result = transformReactJsx(source);
    expect(result.diagnostics.some(d => d.category === "error" && /Class component Counter/.test(d.message))).toBe(true);
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

  it("adopts named aliases and namespace React memo/forwardRef only", () => {
    const named = transformReactJsx(`import { memo as m, forwardRef as ref } from "react";const count=atom(0);export const A=m(()=> <i>{count}</i>);export const B=ref((_props, _r)=> <b>{count}</b>);`);
    expect(named.diagnostics).toEqual([]);
    expect(named.bindingCount).toBe(2);
    const namespace = transformReactJsx(`import * as React from "react";const count=atom(0);export const A=React.memo(()=> <i>{count}</i>);`);
    expect(namespace.bindingCount).toBe(1);
    const unsupported = transformReactJsx(`const count=atom(0);const foreign={memo:(fn)=>fn};export const A=foreign.memo(()=> <i>{count}</i>);`);
    expect(unsupported.diagnostics.some(d => d.category === "error" && /unrecognized wrapper/.test(d.message))).toBe(true);
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
