import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { atom, type Writable } from "@epikodelabs/streamix";
import { transformReactJsx, type ReactJsxTransformResult } from "./compiler";

const sourceFor = (body: string, jsx = "{count}") => `
  import { atom } from "@epikodelabs/streamix";
  export let count = atom(0);
  export let total = atom(0);
  export const model = { count, total };
  export function App({ field }: { field: string }) {
    return <button onClick={() => { ${body} }}>${jsx}</button>;
  }
`;

/** Compile a component whose JSX handler body is `body` and execute the module. */
function compileHandler(body: string, jsx = "{count}") {
  const result = transformReactJsx(sourceFor(body, jsx), "map-writes.tsx");
  const javascript = ts.transpileModule(result.code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} as {
    count: Writable<number>;
    total: Writable<number>;
    model: { count: Writable<number>; total: Writable<number> };
    App(props: { field: string }): React.ReactElement<{ onClick(): unknown; children?: React.ReactNode }>;
  } };
  const require = (name: string) => {
    if (name === "@epikodelabs/streamix") return { atom };
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "@epikodelabs/streamix/react") return {
      useStreamixSource: (source: Writable<unknown>) => source.value,
      useStreamixAfterCommit: () => {},
      __streamixTrace: () => {},
    };
    throw new Error(`Unexpected generated import: ${name}`);
  };
  new Function("React", "require", "exports", javascript)(React, require, module.exports);
  return { result, ...module.exports };
}

function errors(result: ReactJsxTransformResult) {
  return result.diagnostics.filter(diagnostic => diagnostic.category === "error");
}

function transformComponent(body: string): ReactJsxTransformResult {
  return transformReactJsx(
    `import { atom } from "@epikodelabs/streamix";\n` +
    `import { useEffect } from "react";\n` +
    `function App() { let count = atom(0); let other = atom(0); const model = { count }; ${body} return <output>{count}</output>; }`,
    "map-writes-hooks.tsx",
  );
}

describe("React compiler atom-map writes with unresolvable keys", () => {
  it("reports a dynamic-key write instead of lowering it onto the getter-only value accessor", () => {
    const compiled = compileHandler("model[field] = 5;");
    const found = errors(compiled.result);
    expect(found.length).toBe(1);
    expect(found[0].message).toContain('"model[field]"');
    expect(found[0].message).toContain("next(value)");
    expect(compiled.result.code).toContain("model[field] = 5");
    expect(compiled.result.code).not.toContain("model[field].value");
    // The emitted handler no longer throws `Cannot set property value` on click.
    expect(() => compiled.App({ field: "count" }).props.onClick()).not.toThrow();
  });

  it("reports compound and update writes through unresolvable keys", () => {
    for (const body of ["model[field] += 1;", "model[field]++;"]) {
      const compiled = compileHandler(body);
      const found = errors(compiled.result);
      expect(found.length).toBe(1);
      expect(found[0].message).toContain('"model[field]"');
      expect(compiled.result.code).toContain(body);
      expect(compiled.result.code).not.toContain("model[field].value");
      expect(() => compiled.App({ field: "count" }).props.onClick()).not.toThrow();
    }
  });

  it("reports computed keys that are not statically resolvable", () => {
    const body = `model[field === 'count' ? 'count' : 'total'] = 5;`;
    const compiled = compileHandler(body);
    const found = errors(compiled.result);
    expect(found.length).toBe(1);
    expect(found[0].message).toContain("statically resolve");
    expect(compiled.result.code).toContain(body);
    expect(compiled.result.code).not.toContain("].value");
    expect(() => compiled.App({ field: "count" }).props.onClick()).not.toThrow();
  });

  it("reports static keys that are not known atom entries", () => {
    const compiled = compileHandler(`model['unknown'] = 5;`);
    const found = errors(compiled.result);
    expect(found.length).toBe(1);
    expect(found[0].message).toContain('"model[\'unknown\']"');
    expect(compiled.result.code).toContain(`model['unknown'] = 5`);
    expect(compiled.result.code).not.toContain(`model['unknown'].value`);
  });

  it("lowers statically resolvable property writes onto the resolved atom", () => {
    const compiled = compileHandler("model.count = 5;");
    expect(compiled.result.diagnostics).toEqual([]);
    expect(compiled.result.code).toContain("count.next(5)");
    expect(compiled.result.code).not.toContain("model.count.value");
    compiled.App({ field: "count" }).props.onClick();
    expect(compiled.count.value).toBe(5);
    compiled.count.dispose();
  });

  it("lowers statically resolvable bracket writes onto the resolved atom", () => {
    const compiled = compileHandler(`model['total'] = 7;`);
    expect(compiled.result.diagnostics).toEqual([]);
    expect(compiled.result.code).toContain("total.next(7)");
    compiled.App({ field: "total" }).props.onClick();
    expect(compiled.total.value).toBe(7);
    compiled.total.dispose();
  });

  it("keeps reads through dynamic keys working in handlers and JSX", () => {
    const compiled = compileHandler("count.next(model[field] + 1);", "{model[field]}");
    expect(compiled.result.diagnostics).toEqual([]);
    // The handler read observes the current value through the dynamic key.
    expect(compiled.result.code).toContain("count.next(model[field].value + 1)");
    // The JSX read becomes a component-scope dynamic selection binding.
    expect(compiled.result.code).toContain("useStreamixSource(model[field]");
    // The selection resolves to whatever atom lives at the key at runtime.
    const first = compiled.App({ field: "count" });
    expect(first.props.children).toBe(0);
    compiled.count.next(9);
    const second = compiled.App({ field: "count" });
    expect(second.props.children).toBe(9);
    // The handler reads the atom at the requested key, then writes count + 1.
    compiled.App({ field: "count" }).props.onClick();
    expect(compiled.count.value).toBe(10);
    compiled.count.dispose();
  });

  it("reports an unresolvable map write in a hook callback once and still reports bare reads on its right side", () => {
    const result = transformComponent("useEffect(() => { model[field] = other; });");
    const found = errors(result);
    expect(found.length).toBe(2);
    expect(found[0].message).toContain("useEffect");
    expect(found[0].message).toContain('"other"');
    expect(found[1].message).toContain('"model[field]"');
    expect(result.code).toContain("model[field] = other");
    expect(result.code).not.toContain("model[field].value");
  });

  it("leaves shadowed and foreign-object element writes as ordinary JavaScript", () => {
    const result = transformReactJsx(`
      import { atom } from "@epikodelabs/streamix";
      export const count = atom(0);
      export const model = { count };
      export function App({ field }: { field: string }) {
        return <button onClick={() => { const data = { count: 9 }; data[field] = 10; count.next(data[field]); }}>{count}</button>;
      }
    `, "map-writes-shadow.tsx");
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("data[field] = 10");
    expect(result.code).toContain("count.next(data[field])");
  });
});
