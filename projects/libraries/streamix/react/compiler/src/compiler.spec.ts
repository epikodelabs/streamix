import { transformReactJsx } from "./compiler";

describe("React JSX compiler", () => {
  it("preserves explicitly tracked sources with a named reader", () => {
    const result = transformReactJsx(`
      const count = atom(2);
      const total = derived(self => self(count) + self.read(count));
    `);
    expect(result.code).toContain('self(count) + self.read(count)');
  });

  it("adopts direct atom and scoped JSX reads and rewrites atom assignment", () => {
    const result = transformReactJsx(`
      function Counter() {
        let count = atom(0);
        const state = scope({ title: "Ready" });
        return <button title={state.title} onClick={() => count = count + 1}>{count + 1}</button>;
      }
    `);

    expect(result.bindingCount).toBe(2);
    expect(result.code).toContain('import { useStreamixAfterCommit, useStreamixLocal, __streamixTrace, useStreamixSource } from "@epikodelabs/streamix/react"');
    expect(result.code).toContain('useStreamixSource(count, "count")');
    expect(result.code).toContain('useStreamixSource(state.get("title"), "state.title")');
    expect(result.code).toContain('count.next(count.value + 1)');
    expect(result.code).toContain('{__streamixBinding1 + 1}');
  });

  it("keeps local atoms raw inside derived shorthand formulas", () => {
    const result = transformReactJsx(`
      function Counter() {
        const price = atom(2);
        const quantity = atom(3);
        const total = derived(() => price * quantity);
        return <output>{total}</output>;
      }
    `);

    expect(result.code).toContain('derived(() => price.value * quantity.value)');
    expect(result.code).toContain('useStreamixSource(total, "total")');
  });
});
