import { transformReactJsx } from "./compiler";

describe("React JSX compiler", () => {
  it("preserves explicitly tracked sources with a named reader", () => {
    const result = transformReactJsx(`
      const count = atom(2);
      const total = derived(self => self(count) + self.read(count));
    `);
    expect(result.code).toContain('self(count) + self.read(count)');
  });

  it("bridges an empty conditional branch condition without touching the branch", () => {
    const result = transformReactJsx(`
      function Row() {
        const count = atom(0);
        return (
          <section>
            {count > 0 ? null : <em>closed</em>}
          </section>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.bindingCount).toBe(1);
    // The condition is bridged and the empty (null) branch passes through
    // untouched: no structural code is emitted for it.
    expect(result.code).toContain("{__streamixBinding0 > 0 ? null : <em>closed</em>}");
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
    expect(result.code).toContain('count.next(__streamixAssigned');
    expect(result.code).toContain('})(count.value + 1)');
    expect(result.code).toContain('{__streamixBinding1 + 1}');
  });

  it("emits the runtime import when the authored import is type-only", () => {
    const result = transformReactJsx(`
      import type { useStreamixSource } from "@epikodelabs/streamix/react";
      function Counter() {
        const count = atom(0);
        return <output>{count}</output>;
      }
    `);

    expect(result.code).toMatch(
      /import \{[^}]*useStreamixSource[^}]*\} from "@epikodelabs\/streamix\/react";/,
    );
  });

  it("emits the canonical runtime import for an aliased import", () => {
    const result = transformReactJsx(`
      import { useStreamixSource as readSource } from "@epikodelabs/streamix/react";
      function Counter() {
        const count = atom(0);
        return <output>{count}</output>;
      }
    `);

    expect(result.code).toContain("useStreamixSource as readSource");
    expect(result.code).toMatch(
      /import \{[^}]*useStreamixSource[^}]*\} from "@epikodelabs\/streamix\/react";/,
    );
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
