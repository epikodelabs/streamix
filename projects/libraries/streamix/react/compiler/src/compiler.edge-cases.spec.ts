import { transformReactJsx } from "./compiler";

describe("React JSX compiler edge cases", () => {
  it("does not inject runtime code when a component has no reactive JSX read", () => {
    const result = transformReactJsx(`
      function Label({ text }: { text: string }) {
        return <span>{text}</span>;
      }
    `);

    expect(result.bindingCount).toBe(0);
    expect(result.code).not.toContain("__streamixUseSyncExternalStore");
    expect(result.code).toContain("<span>{text}</span>");
    expect(result.sourceMap?.sources.length).toBe(1);
    expect(result.sourceMap?.sourcesContent.join("\n")).toContain("function Label");
    expect(result.sourceMap?.mappings.length).toBeGreaterThan(0);
  });

  it("subscribes to a module-owned atom without changing its ownership", () => {
    const result = transformReactJsx(`
      const status = atom("Saved");
      function Status() { return <output>{status}</output>; }
    `);

    expect(result.bindingCount).toBe(1);
    expect(result.code).toContain("const status = atom(\"Saved\")");
    expect(result.code).toContain('__streamixUse(status, "status")');
    expect(result.code).not.toContain("status.dispose");
  });

  it("lowers a component-local atom into a stable React-owned slot", () => {
    const result = transformReactJsx(`
      function Counter() {
        let count = atom(0);
        return <button>{count}</button>;
      }
    `);

    expect(result.code).toContain("useRef as __streamixUseRef");
    expect(result.code).toContain("let count = __streamixLocal(() => atom(0))");
    expect(result.code).toContain('__streamixUse(count, "count")');
  });

  it("subscribes once when the same atom appears in several JSX expressions", () => {
    const result = transformReactJsx(`
      const status = atom("Saved");
      function Status() {
        return <section title={status}><p>{status}</p><p>{status + "!"}</p></section>;
      }
    `);

    expect(result.bindingCount).toBe(1);
    expect((result.code.match(/__streamixUse\(status, "status"\)/g) ?? []).length).toBe(1);
  });

  it("subscribes independently to each directly-read scope field", () => {
    const result = transformReactJsx(`
      const state = scope({ title: "Ready", enabled: true });
      function Panel() {
        return <input value={state.title} checked={state.enabled} />;
      }
    `);

    expect(result.bindingCount).toBe(2);
    expect(result.code).toContain('__streamixUse(state.get("title"), "state.title")');
    expect(result.code).toContain('__streamixUse(state.get("enabled"), "state.enabled")');
  });

  it("uses the current atom value for the right hand side of a direct assignment", () => {
    const result = transformReactJsx(`
      let count = atom(0);
      function Counter() {
        return <button onClick={() => count = count + 1}>{count}</button>;
      }
    `);

    expect(result.code).toContain("count.next(count.value + 1)");
    expect(result.code).not.toContain("count.next(__streamixBinding");
  });

  it("supports static aliases, dynamic selections from known atom maps, and compound writes", () => {
    const result = transformReactJsx(`
      let count = atom(0);
      const alternate = atom(10);
      function Counter({ useAlternate }: { useAlternate: boolean }) {
        let alias = count;
        const choices = { count, alternate };
        return <button onClick={() => alias += 1}>{useAlternate ? alternate : alias}:{choices[useAlternate ? "alternate" : "count"]}</button>;
      }
    `);

    expect(result.code).toContain("alias.next(alias.value + 1)");
    expect(result.code).toContain('__streamixUse(useAlternate ? alternate : alias, "useAlternate ? alternate : alias")');
    expect(result.code).toContain('__streamixUse(choices[useAlternate ? "alternate" : "count"], "choices[useAlternate ? \\"alternate\\" : \\"count\\"]")');
  });

  it("reports direct assignment to a const atom binding instead of hiding TypeScript's error", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Counter() { return <button onClick={() => count = 1}>{count}</button>; }
    `);

    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].category).toBe("error");
    expect(result.code).toContain("count = 1");
  });

  it("leaves scope property writes as normal scope JavaScript semantics", () => {
    const result = transformReactJsx(`
      const state = scope({ title: "Ready" });
      function Panel() {
        return <input value={state.title} onChange={event => state.title = event.target.value} />;
      }
    `);

    expect(result.code).toContain("state.title = event.target.value");
    expect(result.code).not.toContain("state.title.next");
  });

  it("does not rewrite a locally shadowed atom name in a nested callback", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Counter() {
        return <button onClick={() => {
          const count = 7;
          return count;
        }}>{count}</button>;
      }
    `);

    // The JSX child reads the atom, while the callback keeps its lexical local.
    expect(result.bindingCount).toBe(1);
    expect(result.code).toContain("const count = 7");
    expect(result.code).not.toContain("count.next(7)");
  });

  it("does not treat destructured aliases as reactive bindings", () => {
    const result = transformReactJsx(`
      const model = { count: atom(0) };
      const { count: total } = model;
      function Counter() { return <span>{total}</span>; }
    `);

    expect(result.bindingCount).toBe(0);
    expect(result.code).not.toContain("__streamixUse");
  });

  it("tracks module-level aliases and destructuring from a proven atom map", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      const model = { count };
      const { count: total } = model;
      function Counter() { return <span>{total}:{model.count}</span>; }
    `);

    expect(result.bindingCount).toBe(2);
    expect(result.code).toContain('__streamixUse(total, "total")');
    expect(result.code).toContain('__streamixUse(count, "count")');
  });

  it("tracks destructured aliases and static object paths from a known atom map", () => {
    const result = transformReactJsx(`
      let count = atom(0);
      function Counter() {
        const model = { count };
        let { count: total } = model;
        return <button onClick={() => model.count++}>{total}:{model.count}</button>;
      }
    `);

    expect(result.bindingCount).toBe(2);
    expect(result.code).toContain('__streamixUse(total, "total")');
    expect(result.code).toContain("count.next(");
    expect(result.code).toContain("__streamixPrevious");
  });

  it("does not rewrite computed property access as a scope-field subscription", () => {
    const result = transformReactJsx(`
      const state = scope({ title: "Ready" });
      const field = "title";
      function Panel() { return <span>{state[field]}</span>; }
    `);

    expect(result.bindingCount).toBe(0);
    expect(result.code).toContain("state[field]");
    expect(result.diagnostics[0].message).toContain("Dynamic scope-field reads");
  });

  it("preserves an atom reference when it is passed to a component prop", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Child({ source }: { source: unknown }) { return <span>{String(source)}</span>; }
      function Parent() { return <Child source={count} />; }
    `);

    expect(result.bindingCount).toBe(0);
    expect(result.code).toContain("<Child source={count}/>");
  });

  it("still passes an atom snapshot to a native DOM property", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Field() { return <input value={count} />; }
    `);

    expect(result.bindingCount).toBe(1);
    expect(result.code).toContain("<input value={__streamixBinding0}/>");
  });

  it("preserves an explicit atomRef at a component boundary", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Parent() { return <Child source={atomRef(count)} />; }
    `);

    expect(result.bindingCount).toBe(0);
    expect(result.code).toContain("<Child source={atomRef(count)}/>");
  });

  it("preserves an explicit atomRef across a custom-element boundary", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Parent() { return <x-counter source={atomRef(count)} />; }
    `);

    expect(result.bindingCount).toBe(0);
    expect(result.code).toContain("<x-counter source={atomRef(count)}/>");
  });

  it("preserves prefix and postfix update expression results", () => {
    const result = transformReactJsx(`
      let count = atom(0);
      function Counter() { return <button onClick={() => count++}>{count}</button>; }
    `);

    expect(result.code).toContain("__streamixPrevious");
    expect(result.code).toContain("count.next(");
  });

  it("lowers fully-known destructured assignments without re-evaluating the right side", () => {
    const result = transformReactJsx(`
      let count = atom(0);
      let total = atom(0);
      function Counter() {
        return <button onClick={() => ({ count, total } = load())}>{count}:{total}</button>;
      }
    `);

    expect(result.diagnostics.length).toBe(0);
    expect(result.code).toContain("const __streamixAssigned");
    expect(result.code).toContain("count.next(__streamixAssigned");
    expect(result.code).toContain("total.next(__streamixAssigned");
  });

  it("installs subscriptions through useSyncExternalStore rather than while evaluating JSX", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Counter() { return <span>{count}</span>; }
    `);

    // React invokes the subscribe callback only after a render commits. This
    // protects interrupted/concurrently abandoned renders from subscribing.
    expect(result.code).toContain("return __streamixUseSyncExternalStore(");
    expect(result.code).toContain("entry.stop = source.subscribe");
  });

  it("defers final unsubscribe so Strict Mode's effect re-subscribe preserves a shared source", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Counter() { return <span>{count}</span>; }
    `);

    expect(result.code).toContain("queueMicrotask(() => {");
    expect(result.code).toContain("entry!.generation !== generation || entry!.listeners.size > 0");
    expect(result.code).toContain("void entry!.stop()");
  });

  it("removes the final subscription on unmount and releases its shared registry entry", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Counter() { return <span>{count}</span>; }
    `);

    expect(result.code).toContain("entry!.listeners.delete(notify)");
    expect(result.code).toContain("__streamixSubscriptions.delete(source)");
  });

  it("generates a server snapshot getter alongside the client snapshot getter", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Counter() { return <span>{count}</span>; }
    `);

    expect((result.code.match(/return source\.value; \} catch \{ return undefined; \}/g) ?? []).length).toBe(2);
  });

  it("traces committed component renders without a render-phase side effect", () => {
    const result = transformReactJsx(`
      const count = atom(0);
      function Counter() { return <span>{count}</span>; }
    `);

    expect(result.code).toContain('__streamixTrace("render", "Counter")');
    expect(result.code).toContain("__streamixUseEffect(() => {");
  });
});
