import ts from "typescript";
import { formatReactJsxDiagnostics, transformReactJsx } from "./compiler";

describe("React adoption assessment regressions", () => {
  it("lowers writes in write-only components and ordinary helpers", () => {
    const result = transformReactJsx(`
      let count = atom(1);
      function Reset() { return <button onClick={() => count = 0}>reset</button>; }
      function inc() { count++; }
    `);
    expect(result.diagnostics.filter(d => d.category === "error")).toEqual([]);
    expect(result.code).toContain("count.next(0)");
    expect(result.code).toContain("count.next(__streamixPrevious");
  });

  it("rewrites module-level derived formulas and preserves shorthand object keys", () => {
    const result = transformReactJsx(`
      import { atom, derived } from "@epikodelabs/streamix";
      const price = atom(3), quantity = atom(2);
      const total = derived(() => ({ price, sum: price * quantity }));
    `);
    expect(result.code).toContain("price: price.value");
    expect(result.code).toContain("sum: price.value * quantity.value");
    expect(result.diagnostics).toEqual([]);
  });

  it("uses no React hook in a lowercase ordinary function", () => {
    const result = transformReactJsx(`function get() { const price = atom(2); return derived(() => price * 2); }`);
    expect(result.code).toContain("price.value * 2");
    expect(result.code).not.toContain("useStreamixLocal");
  });

  it("recognizes imported reactive types in a TypeScript program without adopting plain numbers", () => {
    // TypeScript's compiler host depends on Node's system interface; the
    // browser suite exercises the same transform without a Program below.
    if (typeof window !== "undefined") return;
    const fileName = "/virtual/App.tsx";
    const store = "/virtual/store.ts";
    const source = `import { status, count } from "./store"; export function App() { return <output>{status}{count}</output>; }`;
    const storeSource = `export interface AtomLike<T> { readonly value: T; subscribe(callback: () => void): () => void; } export declare const status: AtomLike<string>; export declare const count: number;`;
    const files = new Map([[fileName, source], [store, storeSource]]);
    const options: ts.CompilerOptions = { jsx: ts.JsxEmit.Preserve, noLib: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10 };
    const base = ts.createCompilerHost(options);
    const host: ts.CompilerHost = {
      ...base,
      getSourceFile: (name, languageVersion) => files.has(name)
        ? ts.createSourceFile(name, files.get(name)!, languageVersion, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
        : undefined,
      fileExists: name => files.has(name),
      readFile: name => files.get(name),
      resolveModuleNames: names => names.map(name => name === "./store"
        ? { resolvedFileName: store, extension: ts.Extension.Ts } : undefined),
      getCurrentDirectory: () => "/virtual",
      getDirectories: () => [],
    };
    const program = ts.createProgram([fileName, store], options, host);
    const result = transformReactJsx(source, fileName, { program });
    expect(result.bindingCount).toBe(1);
    expect(result.code).toContain('useStreamixSource(status, "status")');
    expect(result.code).toContain("{count}");
  });

  it("rejects callback-local dynamic selections instead of hoisting out of scope", () => {
    const result = transformReactJsx(`const a=atom(1);const choices={ a };function App({rows}) { return <ul>{rows.map(row => <li>{choices[row.id]}</li>)}</ul> }`);
    expect(result.diagnostics.some(d => d.category === "error" && d.message.includes("callback-local"))).toBe(true);
  });

  it("rewrites handler reads but not property names or shadowed parameters", () => {
    const result = transformReactJsx(`
      let count=atom(0);
      function App({ items, obj }) { return <button onClick={() => {
        if (count === 0) count = obj.count + items.map(count => count * 2).length;
      }}>{count}</button>; }
    `);
    expect(result.code).toContain("if (count.value === 0)");
    expect(result.code).toContain("obj.count");
    expect(result.code).not.toContain("obj.count.value");
    expect(result.code).toContain("items.map(count => count * 2)");
  });

  it("keeps explicit component props as atom references, including namespace and known maps", () => {
    const result = transformReactJsx(`const title=atom('ready');const model={title};function App(){return <><Ui.Editor source={title}/><Ctx.Provider value={title}/><Child source={model.title}/></>}`);
    expect(result.bindingCount).toBe(0);
    expect(result.code).toContain("<Ui.Editor source={title}/>");
    expect(result.code).toContain("<Ctx.Provider value={title}/>");
    expect(result.code).toContain("<Child source={model.title}/>");
  });

  it("uses snapshots for JSX object shorthand and a typed hook name", () => {
    const result = transformReactJsx(`let count=atom(0);function App(){return <div data-x={count} data-info={{count}}/>}`);
    expect(result.code).toContain("count: __streamixBinding");
    expect(result.code).toContain("useStreamixSource(count");
  });

  it("diagnoses nested reactive component functions rather than leaving them silently broken", () => {
    const result = transformReactJsx(`const count=atom(0);function Outer(){function Inner(){return <b>{count}</b>}return <Inner/>}`);
    expect(result.diagnostics.some(d => d.category === "error" && d.message.includes("Nested component"))).toBe(true);
  });

  it("reports a read-only JSX increment without mutating its property", () => {
    const result = transformReactJsx(`const count=atom(0);function App(){return <button onClick={()=>count++}>{count}</button>}`);
    expect(result.diagnostics.some(d => d.message.includes("read-only"))).toBe(true);
    expect(result.code).not.toContain("count.value++");
  });

  it("formats CRLF diagnostics against the original physical line", () => {
    const source = "one\r\ntwo\r\nthree";
    const diagnostics = [{ category: "error" as const, message: "bad", start: source.indexOf("three"), length: 5 }];
    expect(formatReactJsxDiagnostics(source, "example.tsx", diagnostics)).toContain("example.tsx:3:1");
  });
});
