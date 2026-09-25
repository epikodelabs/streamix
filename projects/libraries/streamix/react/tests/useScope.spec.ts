import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { scope, type Scope } from "@epikodelabs/streamix";
import { useScope } from "../src/lib/useScope";

/** Flushes the microtask queue `deferDispose` schedules on. */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useScope", () => {
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

  it("creates the scope once and reuses it across re-renders", () => {
    const seen: unknown[] = [];

    function Widget() {
      const state = useScope(() => scope({ count: 0 }));
      seen.push(state);
      return null;
    }

    act(() => root.render(createElement(Widget)));
    act(() => root.render(createElement(Widget)));

    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("disposes the scope after unmount", async () => {
    let created!: Scope;

    function Widget() {
      const state = useScope(() => scope({ count: 0 }));
      created = state as unknown as Scope;
      return null;
    }

    act(() => root.render(createElement(Widget)));
    expect(created._disposed).toBe(false);

    act(() => root.unmount());
    // Dispose is deferred by one microtask so it can be cancelled by a
    // StrictMode remount; flush before asserting.
    await flushMicrotasks();
    expect(created._disposed).toBe(true);
  });

  it("survives React StrictMode's dev-only mount -> unmount -> remount without losing the scope", async () => {
    let renderCount = 0;
    let lastState!: Scope;
    let sawDisposed = false;

    function Widget() {
      const state = useScope(() => scope({ count: 0 }));
      lastState = state as unknown as Scope;
      if (lastState._disposed) sawDisposed = true;
      renderCount++;
      return null;
    }

    act(() =>
      root.render(createElement(StrictMode, null, createElement(Widget))),
    );

    // Give any (incorrectly) scheduled dispose a chance to run.
    await flushMicrotasks();

    expect(sawDisposed).toBe(false);
    expect(lastState._disposed).toBe(false);
    expect(renderCount).toBeGreaterThan(0);
  });
});
