import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { atom, derived, type Writable } from "@epikodelabs/streamix";
import { transformReactJsx, type ReactJsxTransformResult } from "./compiler";

function errors(result: ReactJsxTransformResult) {
  return result.diagnostics.filter(diagnostic => diagnostic.category === "error");
}

/** Compile a module, execute it with the real runtime, and expose the exports. */
function compileModule<T>(source: string, fileName: string) {
  const result = transformReactJsx(source, fileName);
  const javascript = ts.transpileModule(result.code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName,
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (name === "@epikodelabs/streamix") return { atom, derived };
    throw new Error(`Unexpected generated import: ${name}`);
  };
  new Function("require", "exports", javascript)(require, module.exports);
  return { result, exports: module.exports as T };
}

interface MapModule {
  count: Writable<number>;
  total: Writable<number>;
  model: { count: Writable<number>; total: Writable<number> };
  double: Writable<number>;
  triple: Writable<number>;
  quad: Writable<number>;
  sum: Writable<number>;
  double2: Writable<number>;
  mixed: Writable<number>;
  fromPlain: Writable<number>;
}

/** Compile a component and execute it; useStreamixLocal memoizes by factory text
 * so consecutive renders reuse the same atom and derived instances. */
function compileComponent(source: string, fileName: string) {
  const result = transformReactJsx(source, fileName);
  const javascript = ts.transpileModule(result.code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const locals = new Map<string, unknown>();
  const require = (name: string) => {
    if (name === "@epikodelabs/streamix") return { atom, derived };
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

describe("React compiler atom-map reads inside derived", () => {
  it("adopts angle-bracket casts in TypeScript modules", () => {
    const compiled = compileModule<{ count: Writable<number>; total: Writable<number> }>(`
      import { atom, derived, type Writable } from '@epikodelabs/streamix';
      export const count = <Writable<number>>(atom(2));
      export const total = derived(() => count * 2);
    `, 'cast-module.ts');
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.exports.total.value).toBe(4);
    compiled.exports.count.next(3);
    expect(compiled.exports.total.value).toBe(6);
    compiled.exports.total.dispose();
    compiled.exports.count.dispose();
  });

  it("keeps cast-wrapped component factories owned and writable", () => {
    const compiled = compileComponent(`
      import { atom, derived, type Writable } from '@epikodelabs/streamix';
      export function App() {
        let count = (atom(2)) as Writable<number>;
        const total = derived(() => count * 2) satisfies Writable<number>;
        return <button onClick={() => { count++; }}>{total}</button>;
      }
    `, 'cast-component.tsx');
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.App().props.children).toBe(4);
    compiled.App().props.onClick();
    expect(compiled.App().props.children).toBe(6);
  });

  it("lowers a module-level map member read and recomputes from the atom value", () => {
    const compiled = compileModule<MapModule>(`
      import { atom, derived } from "@epikodelabs/streamix";
      export const count = atom(0);
      export const model = { count };
      export const double = derived(() => model.count * 2);
    `, "derived-maps-module.tsx");
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.result.code).toContain("derived(() => count.value * 2)");
    expect(compiled.result.code).not.toContain("model.count");
    expect(compiled.exports.double.value).toBe(0);
    compiled.exports.count.next(5);
    expect(compiled.exports.double.value).toBe(10);
  });

  it("lowers a map member read through a statically resolvable bracket key", () => {
    const compiled = compileModule<MapModule>(`
      import { atom, derived } from "@epikodelabs/streamix";
      export const count = atom(0);
      export const model = { count };
      export const triple = derived(() => model['count'] * 3);
    `, "derived-maps-bracket.tsx");
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.result.code).toContain("derived(() => count.value * 3)");
    expect(compiled.exports.triple.value).toBe(0);
    compiled.exports.count.next(7);
    expect(compiled.exports.triple.value).toBe(21);
  });

  it("keeps an explicit .value read on a map member intact instead of double-lowering", () => {
    const compiled = compileModule<MapModule>(`
      import { atom, derived } from "@epikodelabs/streamix";
      export const count = atom(0);
      export const model = { count };
      export const quad = derived(() => model.count.value * 4);
    `, "derived-maps-explicit.tsx");
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.result.code).toContain("model.count.value");
    expect(compiled.result.code).not.toContain("count.value.value");
    compiled.exports.count.next(2);
    expect(compiled.exports.quad.value).toBe(8);
  });

  it("lowers map member reads nested in object literals and call arguments", () => {
    const compiled = compileModule<MapModule>(`
      import { atom, derived } from "@epikodelabs/streamix";
      export const count = atom(0);
      export const total = atom(10);
      export const model = { count, total };
      export const sum = derived(() => ({ value: model.count * 2 }).value + Math.max(model.total, 0));
    `, "derived-maps-nested.tsx");
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.result.code).toContain("count.value * 2");
    expect(compiled.result.code).toContain("Math.max(total.value, 0)");
    expect(compiled.exports.sum.value).toBe(10);
    compiled.exports.count.next(4);
    expect(compiled.exports.sum.value).toBe(18);
  });

  it("lowers a component-local map member read and recomputes across renders", () => {
    const compiled = compileComponent(`
      import { atom, derived } from "@epikodelabs/streamix";
      export function App() {
        let count = atom(0);
        const model = { count };
        const double = derived(() => model.count * 2);
        return <button onClick={() => { count.next(4); }}>{double}</button>;
      }
    `, "derived-maps-local.tsx");
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.result.code).toContain("derived(() => count.value * 2)");
    expect(compiled.result.code).not.toContain("model.count");
    expect(compiled.App().props.children).toBe(0);
    compiled.App().props.onClick();
    expect(compiled.App().props.children).toBe(8);
  });

  it("keeps bare-identifier controls lowering and recomputing", () => {
    const compiled = compileModule<MapModule>(`
      import { atom, derived } from "@epikodelabs/streamix";
      export const count = atom(0);
      export const double2 = derived(() => count * 2);
    `, "derived-maps-bare.tsx");
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.result.code).toContain("derived(() => count.value * 2)");
    expect(compiled.exports.double2.value).toBe(0);
    compiled.exports.count.next(6);
    expect(compiled.exports.double2.value).toBe(12);
  });

  it("keeps a callback parameter winning over a map of the same name", () => {
    const compiled = compileModule<MapModule>(`
      import { atom, derived } from "@epikodelabs/streamix";
      export const count = atom(0);
      export const model = { count };
      export const mixed = derived((model) => model.count + 1);
    `, "derived-maps-param.tsx");
    expect(errors(compiled.result)).toEqual([]);
    // The parameter is a DerivedScope reader; its member stays raw.
    expect(compiled.result.code).toContain("derived((model) => model.count + 1)");
    expect(compiled.result.code).not.toContain("count.value + 1");
  });

  it("does not rewrite catch bindings or loop headers shadowing an atom inside derived", () => {
    const compiled = compileModule<{ price: Writable<number>; totals: Writable<number> }>(`
      import { atom, derived } from "@epikodelabs/streamix";
      export const price = atom(2);
      export const totals = derived(() => {
        let sum = 0;
        try { JSON.parse("{"); } catch (price) { sum += price instanceof SyntaxError ? 1 : 0; }
        for (const price of [3, 4]) sum += price;
        return sum + price.value;
      });
    `, "derived-maps-shadow.tsx");
    expect(errors(compiled.result)).toEqual([]);
    // The shadowed loop variable and catch binding stay raw; the genuine
    // outer atom read still lowers.
    expect(compiled.result.code).toContain("sum += price;");
    expect(compiled.result.code).not.toContain("sum += price.value;");
    expect(compiled.result.code).toContain("return sum + price.value;");
    // catch(1) + loop(3 + 4) + outer atom value(2): the computed value proves
    // the shadowed names are plain numbers, not atom reads.
    expect(compiled.exports.totals.value).toBe(10);
  });

  it("keeps destructured callback parameters shadowing atoms inside derived", () => {
    const compiled = compileModule<MapModule>(`
      import { atom, derived } from "@epikodelabs/streamix";
      export const count = atom(2);
      export const total = derived(({ count }) => count * 2);
    `, "derived-destructured-shadow.tsx");
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.result.code).toContain("({ count }) => count * 2");
    expect(compiled.result.code).not.toContain("count.value * 2");
  });

  it("leaves members of unproven plain objects as ordinary JavaScript", () => {
    const compiled = compileModule<MapModule>(`
      import { atom, derived } from "@epikodelabs/streamix";
      export const count = atom(0);
      const plain = { count: 9 };
      export const fromPlain = derived(() => plain.count * 2);
    `, "derived-maps-plain.tsx");
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.result.code).toContain("plain.count * 2");
    expect(compiled.exports.fromPlain.value).toBe(18);
  });
});

describe("React compiler source API reads", () => {
  it("keeps source API members raw inside derived callbacks", () => {
    const compiled = compileModule<{
      count: Writable<number>;
      safe: Writable<number>;
      raw: Writable<number>;
      mapped: Writable<number[]>;
      indexed: Writable<number>;
    }>(`
      import { atom, derived } from "@epikodelabs/streamix";
      export const count = atom(1);
      export const other = atom(0);
      export const items = atom([1, 2]);
      export const safe = derived(() => count.safeValue);
      export const raw = derived(() => count['value']);
      export const write = derived(() => { other.set(count); return count; });
      export const mapped = derived(() => items.map(item => item * 2));
      export const indexed = derived(() => items[0] + 1);
    `, "derived-source-api.tsx");
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.result.code).toContain("count.safeValue");
    expect(compiled.result.code).toContain("count['value']");
    expect(compiled.result.code).toContain("other.set(count.value)");
    expect(compiled.result.code).toContain("items.value.map(item => item * 2)");
    expect(compiled.result.code).toContain("items.value[0] + 1");
    expect(compiled.result.code).not.toContain("count.value.safeValue");
    expect(compiled.result.code).not.toContain("count.value['value']");
    expect(compiled.result.code).not.toContain("other.value.set");
  });

  it("rejects asynchronous derived formulas at build time", () => {
    for (const callback of [
      "async () => count",
      "async function () { return count; }",
      "async function* () { yield count; return count; }",
    ]) {
      const result = transformReactJsx(`
        import { atom, derived } from "@epikodelabs/streamix";
        export const count = atom(1);
        export const value = derived(${callback});
      `, "async-derived.tsx");
      expect(result.diagnostics.some(diagnostic =>
        diagnostic.category === "error" && diagnostic.message.includes("synchronously"),
      )).withContext(callback).toBeTrue();
    }

    const sync = transformReactJsx(`
      import { atom, derived, flow } from "@epikodelabs/streamix";
      export const count = atom(1);
      export const doubled = derived(() => count * 2);
      export const generated = derived(function* () { yield count; return count; });
      export const updates = flow(async function* () { yield 1; });
    `, "sync-derived.tsx");
    expect(sync.diagnostics).toEqual([]);
  });

  it("keeps source API calls raw in component handlers and JSX", () => {
    const compiled = compileComponent(`
      import { atom } from "@epikodelabs/streamix";
      export const count = atom(1);
      export function App() {
        return <button onClick={() => count.set(count.value + 1)}>{count.safeValue}</button>;
      }
    `, "component-source-api.tsx");
    expect(errors(compiled.result)).toEqual([]);
    expect(compiled.result.code).toContain("count.set(count.value + 1)");
    expect(compiled.result.code).toContain("count.safeValue");
    expect(compiled.result.code).not.toContain("count.value.set");
    expect(compiled.result.code).not.toContain("count.value.safeValue");
    const element = compiled.App();
    expect(element.props.children).toBe(1);
    // The handler stays a real atom write instead of `count.value.set(...)`.
    expect(() => element.props.onClick()).not.toThrow();
  });
});
