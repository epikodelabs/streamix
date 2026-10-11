import ts from "typescript";
import { transformReactJsx } from "./compiler";

function parseErrors(file: ts.SourceFile): readonly ts.Diagnostic[] {
  return (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
}

function decodeVlq(segment: string): number[] {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let value = 0, shift = 0;
  const values: number[] = [];
  for (const symbol of segment) {
    const digit = alphabet.indexOf(symbol);
    value |= (digit & 31) << shift;
    if (digit & 32) shift += 5;
    else { values.push((value & 1) ? -(value >> 1) : value >> 1); value = 0; shift = 0; }
  }
  return values;
}

function originalAt(sourceMap: NonNullable<ReturnType<typeof transformReactJsx>["sourceMap"]>, generated: string, offset: number): number | undefined {
  const lines = generated.slice(0, offset).split("\n");
  const row = lines.length - 1, col = lines[lines.length - 1].length;
  let sourceLine = 0, sourceCol = 0, match: {row:number; col:number} | undefined;
  const generatedLines = sourceMap.mappings.split(";");
  for (let line = 0; line <= row; line++) {
    let generatedCol = 0;
    for (const segment of (generatedLines[line] ?? "").split(",").filter(Boolean)) {
      const values = decodeVlq(segment);
      generatedCol += values[0];
      if (values.length !== 4) {
        if (line === row && generatedCol <= col) match = undefined;
        continue;
      }
      sourceLine += values[2]; sourceCol += values[3];
      if (line === row && generatedCol <= col) match = {row: sourceLine,col: sourceCol};
    }
  }
  if (!match) return undefined;
  const originalLines = sourceMap.sourcesContent[0].split("\n");
  return originalLines.slice(0,match.row).reduce((s,l)=>s+l.length+1,0)+match.col;
}

describe("React release-blocker regressions", () => {
  it("transforms plain TypeScript helpers and module formulas as TS instead of TSX", () => {
    const src = `import { atom, derived } from "@epikodelabs/streamix";\nlet count = atom(1);\nexport function inc<T extends number>(step:T) { count += step; }\nexport const doubled = derived(() => count * 2);`;
    const result = transformReactJsx(src, "store.ts");
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("count.next(count.value + step)");
    expect(result.code).toContain("derived(() => count.value * 2)");
    expect(parseErrors(ts.createSourceFile("store.ts",result.code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)).length).toBe(0);
  });

  it("emits JavaScript-compatible JSX with no TS `as any` assertions", () => {
    const src = `import { atom } from '@epikodelabs/streamix'; let count = atom(0); const choices = { count }; export function App({ index }) { return <output>{choices[index]}</output>; }`;
    const result = transformReactJsx(src,"Counter.jsx");
    expect(result.code).not.toContain("as any");
    expect(parseErrors(ts.createSourceFile("Counter.jsx",result.code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX)).length).toBe(0);
  });

  it("maps repeated original identifiers by their exact occurrence", () => {
    const src = `import { atom } from "@epikodelabs/streamix";\nconst count = atom(0);\nexport function Counter() { const label = "count"; return <span title={label}>{label} / {count} / {label}</span>; }`;
    const out = transformReactJsx(src,"Counter.tsx");
    const occurrences = [...out.code.matchAll(/\blabel\b/g)].map(m=>m.index);
    const original = [...src.matchAll(/\blabel\b/g)].map(m=>m.index);
    // For each authored label occurrence in the generated output, the exact
    // original line/column must match the corresponding authored occurrence.
    expect(occurrences.length).toBe(original.length);
    for (let i=0;i<occurrences.length;i++) expect(originalAt(out.sourceMap!,out.code,occurrences[i])).toBe(original[i]);
    expect(originalAt(out.sourceMap!,out.code,out.code.lastIndexOf("useStreamixSource"))).toBe(undefined);
  });
});

describe("long generated source maps", () => {
  it("retains authored line mappings when hundreds of inserted subscriptions exceed the global diff budget", () => {
    const atoms = Array.from({length: 120},(_,i)=>`const value${i} = atom(${i});`).join("\n");
    const entries = Array.from({length: 120},(_,i)=>`<span id="row-${i}">{value${i}}</span>`).join("\n");
    const src = `import { atom } from "@epikodelabs/streamix";\n${atoms}\nexport function App() { return <section>\n${entries}\n</section>; }`;
    const out = transformReactJsx(src,"Many.tsx");
    expect(out.bindingCount).toBe(120);
    const original = src.indexOf('<span id="row-119"');
    const generated = out.code.indexOf('<span id="row-119"');
    expect(originalAt(out.sourceMap!,out.code,generated)).toBe(original);
  });
});
