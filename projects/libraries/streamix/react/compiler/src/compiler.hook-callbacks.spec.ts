import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { atom } from "@epikodelabs/streamix";
import { transformReactJsx } from "./compiler";

const hookImports = `import { useCallback, useEffect, useMemo } from "react";\n`;

function transform(body: string, imports = hookImports) {
  return transformReactJsx(
    `${imports}function App() { let count = atom(0); ${body} return <output>{count}</output>; }`,
    "hook-callbacks.tsx",
  );
}

function errors(body: string, imports = hookImports) {
  return transform(body, imports).diagnostics.filter(diagnostic => diagnostic.category === "error");
}

/** Compile and execute a component with React hooks stubbed for plain Node. */
function execute(body: string) {
  const result = transformReactJsx(
    `import { atom } from "@epikodelabs/streamix";
     import { useEffect, useMemo, useCallback } from "react";
     export let count = atom(0);
     export const effects: Array<() => void> = [];
     export function App() { ${body} }`,
    "hook-callbacks-runtime.tsx",
  );
  const javascript = ts.transpileModule(result.code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {} as {
    count: ReturnType<typeof atom<number>>;
    effects: Array<() => void>;
    App(): React.ReactElement<{ onClick(): unknown }>;
  };
  const require = (name: string) => {
    if (name === "@epikodelabs/streamix") return {
      atom,
      read: (source: { value: unknown }) => source.value,
      write: (source: { next(value: unknown): void }, value: unknown) => source.next(value),
      atomRef: (source: unknown) => source,
    };
    if (name === "react") return {
      useEffect: (effect: () => void) => { exports.effects.push(effect); },
      useMemo: (factory: () => unknown) => factory(),
      useCallback: (callback: unknown) => callback,
    };
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "@epikodelabs/streamix/react") return {
      useStreamixSource: (source: { value: unknown }) => source.value,
      useStreamixLocal: (factory: () => unknown) => factory(),
      useStreamixAfterCommit: () => {},
      __streamixTrace: () => {},
    };
    throw new Error(`Unexpected generated import: ${name}`);
  };
  new Function("React", "require", "exports", javascript)(React, require, exports);
  return { result, exports };
}

describe("React non-JSX callback boundaries", () => {
  it("reports bare atom reads inside useMemo, useEffect, and useCallback", () => {
    const cases = [
      { hook: "useMemo", body: `const value = useMemo(() => count * 2, []);` },
      { hook: "useEffect", body: `useEffect(() => { console.log(count); });` },
      { hook: "useCallback", body: `const read = useCallback(() => count * 2, []);` },
    ];
    for (const test of cases) {
      const found = errors(test.body);
      expect(found.length).toBe(1);
      expect(found[0].message).toContain(test.hook);
      expect(found[0].message).toContain(`"count"`);
      expect(found[0].message).toContain("count.value");
    }
  });

  it("reports named callbacks referenced by hooks without duplicating diagnostics", () => {
    const found = errors(`const read = () => count * 2; useMemo(read, []); useEffect(read);`);
    expect(found.length).toBe(1);
    expect(found[0].message).toContain(`"count"`);
  });

  it("leaves mixed read/write callbacks diagnostic-free when the write lowering covers the read", () => {
    const result = transform(`useEffect(() => { count = count + 1; });`);
    expect(result.diagnostics.filter(diagnostic => diagnostic.category === "error")).toEqual([]);
    expect(result.code).toContain("count.next(count.value + 1)");
  });

  it("still reports a standalone read alongside a lowered write", () => {
    const found = errors(`useEffect(() => { count = count + 1; console.log(count); });`);
    expect(found.length).toBe(1);
    expect(found[0].message).toContain("useEffect");
  });

  it("keeps JSX handlers and explicit reads on the lowering path", () => {
    const jsx = transformReactJsx(
      `${hookImports}function App() { let count = atom(0); return <button onClick={() => console.log(count)}>{count}</button>; }`,
      "hook-callbacks.tsx",
    );
    expect(jsx.diagnostics).toEqual([]);
    expect(jsx.code).toContain("count.value");
    expect(errors(`useMemo(() => count.value * 2, []);`)).toEqual([]);
  });

  it("accepts explicit atom APIs and shadowed bindings", () => {
    expect(errors(`
      useEffect(() => {
        read(count);
        write(count, count.value + 1);
        const ref = atomRef(count);
        console.log(count.value);
      });
    `)).toEqual([]);
    expect(errors(`const value = useMemo(() => { const count = 2; return count * 2; }, []);`)).toEqual([]);
    expect(errors(`useEffect(() => { [1].map((count) => count * 2); });`)).toEqual([]);
  });

  it("recognizes aliased and namespaced hook imports", () => {
    const aliased = errors(
      `const value = memo(() => count * 2, []);`,
      `import { useMemo as memo } from "react";\n`,
    );
    expect(aliased.length).toBe(1);
    expect(aliased[0].message).toContain("useMemo");
    const namespaced = errors(
      `const value = React.useCallback(() => count * 2, []);`,
      `import React from "react";\n`,
    );
    expect(namespaced.length).toBe(1);
    expect(namespaced[0].message).toContain("useCallback");
  });

  it("does not mistake a shadowed hook import for a React hook", () => {
    expect(errors(`const useMemo = (callback) => callback; useMemo(() => count * 2);`)).toEqual([]);
    expect(errors(`const React = { useMemo: callback => callback }; React.useMemo(() => count * 2);`,
      `import * as React from 'react';`)).toEqual([]);
  });

  it("resolves a component callback before a module callback with the same name", () => {
    const result = transformReactJsx(`
      ${hookImports}
      let count = atom(0);
      const handler = () => count.value;
      function App() {
        const handler = () => count * 2;
        useMemo(handler, []);
        return <output>{count}</output>;
      }
    `, 'hook-callbacks.tsx');
    expect(result.diagnostics.filter(diagnostic => diagnostic.category === 'error').length).toBe(1);
  });

  it("reports atom-map reads without rejecting their explicit .value form", () => {
    const map = `const choices = { count: count };`;
    const read = errors(`${map} const value = useMemo(() => choices.count * 2, []);`);
    expect(read.length).toBe(1);
    expect(read[0].message).toContain(`"count"`);
    expect(errors(`${map} const value = useMemo(() => choices.count.value * 2, []);`)).toEqual([]);
  });

  it("executes a lowered mixed read/write effect callback", () => {
    const { result, exports } = execute(`useEffect(() => { count = count + 1; }); return <span>{count}</span>;`);
    expect(result.diagnostics.filter(diagnostic => diagnostic.category === "error")).toEqual([]);
    exports.App();
    for (const effect of exports.effects) effect();
    expect(exports.count.value).toBe(1);
    exports.count.dispose();
  });

  it("executes a lowered JSX handler atom read as a value", () => {
    const { result, exports } = execute(`return <button onClick={() => count * 2}>go</button>;`);
    expect(result.diagnostics.filter(diagnostic => diagnostic.category === "error")).toEqual([]);
    const handler = exports.App().props.onClick;
    expect(handler()).toBe(0);
    exports.count.next(3);
    expect(handler()).toBe(6);
    exports.count.dispose();
  });
});
