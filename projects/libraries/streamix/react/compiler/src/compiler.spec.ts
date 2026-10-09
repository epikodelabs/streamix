import { transformReactJsx } from "./compiler";

describe("React JSX compiler", () => {
  it("adopts direct atom and scoped JSX reads and rewrites atom assignment", () => {
    const result = transformReactJsx(`
      function Counter() {
        let count = atom(0);
        const state = scope({ title: "Ready" });
        return <button title={state.title} onClick={() => count = count + 1}>{count + 1}</button>;
      }
    `);

    expect(result.bindingCount).toBe(2);
    expect(result.code).toContain('useSyncExternalStore as __streamixUseSyncExternalStore');
    expect(result.code).toContain('__streamixUse(count)');
    expect(result.code).toContain('__streamixUse(state.get("title"))');
    expect(result.code).toContain('count.next(count.value + 1)');
    expect(result.code).toContain('{__streamixBinding1 + 1}');
  });
});
