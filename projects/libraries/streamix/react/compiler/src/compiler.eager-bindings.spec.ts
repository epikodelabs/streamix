import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { atom, type Writable } from "@epikodelabs/streamix";
import { transformReactJsx, type ReactJsxTransformResult } from "./compiler";

function errors(result: ReactJsxTransformResult) {
  return result.diagnostics.filter(diagnostic => diagnostic.category === "error");
}

function compile(source: string, fileName: string) {
  return transformReactJsx(source, fileName);
}

/** Compile a component, execute it, and return the App render function. */
function compileRunnable(source: string, fileName: string) {
  const result = transformReactJsx(source, fileName);
  const javascript = ts.transpileModule(result.code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const locals = new Map<string, unknown>();
  const require = (name: string) => {
    if (name === "@epikodelabs/streamix") return { atom };
    if (name === "react") return { useMemo: (factory: () => unknown) => factory() };
    if (name === "@epikodelabs/streamix/react") return {
      useStreamixSource: (source: Writable<unknown>) => source.value,
      useStreamixLocal: (factory: () => unknown) => {
        const key = factory.toString();
        if (!locals.has(key)) locals.set(key, factory());
        return locals.get(key);
      },
      useStreamixAfterCommit: () => {},
      __streamixTrace: () => {},
    };
    if (name === "react/jsx-runtime") return jsxRuntime;
    throw new Error(`Unexpected generated import: ${name}`);
  };
  const exports = { App: undefined as unknown as (props?: Record<string, unknown>) => React.ReactElement<{ onClick(): unknown; children?: React.ReactNode }> };
  new Function("React", "require", "exports", javascript)(React, require, exports);
  return { result, App: exports.App };
}

describe("React compiler eager reads of generated bindings", () => {
  it("reports a closure invoked before the reactive declarations", () => {
    const result = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        const render = () => <div>{count}</div>;
        const early = render();
        let count = atom(0);
        return <div>{early}{count}</div>;
      }
    `, "eager-named.tsx");
    const found = errors(result);
    expect(found.length).toBe(1);
    expect(found[0].message).toContain('"render"');
    expect(found[0].message).toContain("before initialization");
    // Diagnosed, not reordered: the binding still initializes after the call.
    const bindingAt = result.code.indexOf("const __streamixBinding0");
    const callAt = result.code.indexOf("render()");
    expect(callAt).toBeGreaterThan(-1);
    expect(bindingAt).toBeGreaterThan(callAt);
  });

  it("reports an IIFE rendering reactive JSX before the declarations", () => {
    const result = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        const early = (() => <div>{count}</div>)();
        let count = atom(0);
        return <div>{early}{count}</div>;
      }
    `, "eager-iife.tsx");
    const found = errors(result);
    expect(found.length).toBe(1);
    expect(found[0].message).toContain("an inline closure");
  });

  it("reports calls through hoisted function declarations", () => {
    const result = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        const early = renderTitle();
        let count = atom(0);
        function renderTitle() { return <div>{count}</div>; }
        return <div>{early}{count}</div>;
      }
    `, "eager-hoisted.tsx");
    const found = errors(result);
    expect(found.length).toBe(1);
    expect(found[0].message).toContain('"renderTitle"');
  });

  it("reports eager callbacks passed to synchronous array methods", () => {
    const result = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        const first = [1].map(() => <div>{count}</div>)[0];
        let count = atom(0);
        return <div>{first}{count}</div>;
      }
    `, "eager-sync-method.tsx");
    const found = errors(result);
    expect(found.length).toBe(1);
  });

  it("reports chained closures through an inherited reference", () => {
    const result = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        const inner = () => <div>{count}</div>;
        const outer = () => inner();
        const early = outer();
        let count = atom(0);
        return <div>{early}{count}</div>;
      }
    `, "eager-chain.tsx");
    const found = errors(result);
    expect(found.length).toBe(1);
    expect(found[0].message).toContain('"outer"');
  });

  it("reports a useMemo factory invoked during the call", () => {
    const result = compile(`
      import { atom } from "@epikodelabs/streamix";
      import { useMemo } from "react";
      export function App() {
        const early = useMemo(() => <div>{count}</div>, []);
        let count = atom(0);
        return <div>{early}{count}</div>;
      }
    `, "eager-usememo.tsx");
    const found = errors(result);
    expect(found.length).toBe(1);
  });

  it("reports a statement that renders reactive JSX itself before the declarations", () => {
    const result = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        const early = <div>{count}</div>;
        let count = atom(0);
        return <div>{early}{count}</div>;
      }
    `, "eager-jsx.tsx");
    const found = errors(result);
    expect(found.length).toBe(1);
    expect(found[0].message).toContain("renders reactive JSX");
  });

  it("keeps the declaration-first order diagnostic-free and runnable", () => {
    const compiled = compileRunnable(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        let count = atom(0);
        const render = () => <div>{count}</div>;
        const early = render();
        return <div>{early}</div>;
      }
    `, "eager-control.tsx");
    expect(errors(compiled.result)).toEqual([]);
    // The binding initializes before the eager call that reads it.
    const bindingAt = compiled.result.code.indexOf("const __streamixBinding0");
    const callAt = compiled.result.code.indexOf("render()");
    expect(bindingAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(bindingAt);
    expect(compiled.App().props.children).toBeInstanceOf(Object);
    // The early element reads the binding snapshot, which is the count value.
    expect((compiled.App().props.children as React.ReactElement<{ children?: React.ReactNode }>).props.children).toBe(0);
  });

  it("does not flag stored handlers or shared atom props before the declarations", () => {
    const stored = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        const early = <button onClick={() => <b>{count}</b>}>x</button>;
        let count = atom(0);
        return <div>{early}</div>;
      }
    `, "eager-stored.tsx");
    expect(errors(stored)).toEqual([]);

    const sharedProp = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        const early = <Child source={count} />;
        let count = atom(0);
        return <div>{early}</div>;
      }
    `, "eager-shared-prop.tsx");
    expect(errors(sharedProp)).toEqual([]);
  });

  it("resolves call sites without being fooled by shadowed names", () => {
    const result = compile(`
      import { atom } from "@epikodelabs/streamix";
      const title = atom("Hi");
      export function App() {
        const render = () => <div>{title}</div>;
        { const render = () => 5; render(); }
        let count = atom(0);
        return <div>{count}</div>;
      }
    `, "eager-shadow.tsx");
    expect(errors(result)).toEqual([]);
  });
});
