import { transformReactJsx } from "./compiler";

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
});
