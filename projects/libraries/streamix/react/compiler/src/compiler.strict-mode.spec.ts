import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { atom, type Writable } from "@epikodelabs/streamix";
import { transformReactJsx } from "./compiler";
import { idescribe } from "../../src/tests/env.spec";

idescribe("React JSX compiler Strict Mode semantics", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("double-renders a component-local atom initializer in development Strict Mode", () => {
    const created: Writable<number>[] = [];

    function Counter() {
      // This is intentionally the source form accepted by the compiler today.
      // The compiler preserves this declaration in the component body.
      const count = atom(0);
      created.push(count);
      return createElement("span", null, String(count.value));
    }

    act(() => root.render(createElement(StrictMode, null, createElement(Counter))));

    expect(created.length).toBe(2);
    expect(created[0]).not.toBe(created[1]);
    expect(container.textContent).toBe("0");

    // The first instance came from the development-only abandoned render. It
    // is never mounted or disposed by React, which is why local atom creation
    // needs a stable ownership strategy before this syntax can be promised.
    expect(created[0].disposed).toBe(false);
    expect(created[1].disposed).toBe(false);
  });

  it("lowers a component-local scope through the same Strict-Mode-safe local slot", () => {
    const result = transformReactJsx(`
      import { scope } from "@epikodelabs/streamix";
      function Panel() {
        const state = scope({ title: "Ready" });
        return <output>{state.title}</output>;
      }
    `);

    expect(result.code).toContain("const state = __streamixLocal(() => scope({ title: \"Ready\" }))");
    expect(result.code).toContain('__streamixUse(state.get("title"), "state.title")');
  });

  it("rejects observable work in local atom and scope initialization", () => {
    const result = transformReactJsx(`
      function Panel() {
        const state = scope({ title: loadTitle() });
        const count = atom(startCounter());
        return <output>{state.title}:{count}</output>;
      }
    `);

    expect(result.diagnostics.length).toBe(2);
    expect(result.diagnostics.every(diagnostic => diagnostic.category === "error")).toBe(true);
    expect(result.diagnostics[0].message).toContain("render-pure");
  });
});
