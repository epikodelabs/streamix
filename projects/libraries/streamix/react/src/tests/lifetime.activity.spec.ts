import * as React from "react";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createStreamixLifetime,
  StreamixLifetimeProvider,
  useAtom,
  useAtomValue,
  useResource,
  useStreamixLocal,
  type PreloadedResource,
} from "../lib/runtime";
import { atom, scope, type Writable } from "@epikodelabs/streamix";
import { idescribe } from "./env.spec";

idescribe("Streamix explicit lifetime across React Activity", () => {
  it("does not dispose a committed atom while Activity is hidden, and disposes it at owner shutdown", async () => {
    const Activity = (React as unknown as { Activity?: React.ComponentType<{ mode: "visible" | "hidden"; children?: React.ReactNode }> }).Activity;
    if (!Activity) { pending("Requires React with Activity support"); return; }
    const host = document.createElement("div");
    const root = createRoot(host);
    const lifetime = createStreamixLifetime();
    const created: Writable<number>[] = [];
    function Counter() {
      const value = useAtom(() => {
        const instance = atom(1);
        created.push(instance);
        return instance;
      });
      return createElement("output", null, String(value.value));
    }
    // Arrow (not a hoisted declaration) so TS keeps the `Activity` narrowing above.
    const render = (mode: "visible" | "hidden") => {
      root.render(createElement(StreamixLifetimeProvider, { lifetime },
        createElement(StrictMode, null, createElement(Activity, { mode }, createElement(Counter)))));
    };
    try {
      await act(async () => render("visible"));
      const count = created.filter(value => !value.disposed).length;
      expect(count).toBeGreaterThan(0);
      const last = created[created.length - 1];
      await act(async () => render("hidden"));
      expect(last.disposed).toBe(false);
      await act(async () => render("visible"));
      expect(last.disposed).toBe(false);
      await act(async () => root.unmount());
      lifetime.dispose();
      expect(last.disposed).toBe(true);
    } finally {
      lifetime.dispose();
      host.remove();
    }
  });

  it("recreates a no-provider useAtom instance after Activity hide/show", async () => {
    const Activity = (React as unknown as { Activity?: React.ComponentType<{ mode: "visible" | "hidden"; children?: React.ReactNode }> }).Activity;
    if (!Activity) { pending("Requires React with Activity support"); return; }
    const host = document.createElement("div");
    const root = createRoot(host);
    let current!: Writable<number>;
    let unmounted = false;
    function Counter() {
      const instance = useAtom(() => atom(1));
      current = instance;
      const value = useAtomValue(instance);
      return createElement("output", null, String(value));
    }
    const render = (mode: "visible" | "hidden") => {
      root.render(createElement(StrictMode, null, createElement(Activity, { mode }, createElement(Counter))));
    };
    try {
      await act(async () => render("visible"));
      expect(host.textContent).toBe("1");
      const before = current;
      expect(before.disposed).toBe(false);

      await act(async () => render("hidden"));
      await act(async () => { await Promise.resolve(); });
      expect(before.disposed).toBe(true);

      await act(async () => render("visible"));
      await act(async () => { await Promise.resolve(); });
      expect(current === before).toBe(false);
      expect(current.disposed).toBe(false);
      expect(host.textContent).toBe("1");
      await act(async () => { current.next(2); });
      expect(host.textContent).toBe("2");

      const revived = current;
      await act(async () => { root.unmount(); unmounted = true; });
      await act(async () => { await Promise.resolve(); });
      expect(revived.disposed).toBe(true);
    } finally {
      if (!unmounted) await act(async () => root.unmount());
      host.remove();
    }
  });

  it("recreates a no-provider useStreamixLocal instance after Activity hide/show", async () => {
    const Activity = (React as unknown as { Activity?: React.ComponentType<{ mode: "visible" | "hidden"; children?: React.ReactNode }> }).Activity;
    if (!Activity) { pending("Requires React with Activity support"); return; }
    const host = document.createElement("div");
    const root = createRoot(host);
    let current!: Writable<string>;
    function View() {
      const instance = useStreamixLocal(() => atom("local"));
      current = instance;
      const value = useAtomValue(instance);
      return createElement("output", null, value);
    }
    const render = (mode: "visible" | "hidden") => {
      root.render(createElement(StrictMode, null, createElement(Activity, { mode }, createElement(View))));
    };
    try {
      await act(async () => render("visible"));
      expect(host.textContent).toBe("local");
      const before = current;

      await act(async () => render("hidden"));
      await act(async () => { await Promise.resolve(); });
      expect(before.disposed).toBe(true);

      await act(async () => render("visible"));
      await act(async () => { await Promise.resolve(); });
      expect(current === before).toBe(false);
      expect(current.disposed).toBe(false);
      await act(async () => { current.next("revived"); });
      expect(host.textContent).toBe("revived");
      const revived = current;
      await act(async () => render("hidden"));
      expect(revived.disposed).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("recreates a no-provider useStreamixLocal scope after Activity hide/show", async () => {
    const Activity = (React as unknown as { Activity?: React.ComponentType<{ mode: "visible" | "hidden"; children?: React.ReactNode }> }).Activity;
    if (!Activity) { pending("Requires React with Activity support"); return; }
    const host = document.createElement("div");
    const root = createRoot(host);
    const makeScope = () => scope({ count: 1 });
    let current!: ReturnType<typeof makeScope>;
    function View() {
      const state = useStreamixLocal(makeScope);
      current = state;
      return createElement("output", null, String(state.count));
    }
    const render = (mode: "visible" | "hidden") => {
      root.render(createElement(StrictMode, null, createElement(Activity, { mode }, createElement(View))));
    };
    try {
      await act(async () => render("visible"));
      expect(host.textContent).toBe("1");
      const before = current;
      expect(before._disposed).toBe(false);

      await act(async () => render("hidden"));
      await act(async () => { await Promise.resolve(); });
      expect(before._disposed).toBe(true);

      await act(async () => render("visible"));
      await act(async () => { await Promise.resolve(); });
      expect(current === before).toBe(false);
      expect(current._disposed).toBe(false);
      expect(host.textContent).toBe("1");
      const revived = current;
      await act(async () => render("hidden"));
      expect(revived._disposed).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("recreates a no-provider useResource after Activity hide/show", async () => {
    const Activity = (React as unknown as { Activity?: React.ComponentType<{ mode: "visible" | "hidden"; children?: React.ReactNode }> }).Activity;
    if (!Activity) { pending("Requires React with Activity support"); return; }
    const host = document.createElement("div");
    const root = createRoot(host);
    let loads = 0;
    let current!: PreloadedResource<string>;
    function View() {
      const resource = useResource(() => {
        loads++;
        return Promise.resolve("loaded");
      }, []);
      current = resource as PreloadedResource<string>;
      return createElement("output", null, resource.status === "ready" ? String(resource.data) : resource.status);
    }
    const render = (mode: "visible" | "hidden") => {
      root.render(createElement(StrictMode, null, createElement(Activity, { mode }, createElement(View))));
    };
    try {
      await act(async () => render("visible"));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(host.textContent).toBe("loaded");
      const before = current;
      expect(before.disposed).toBe(false);
      const loadsBeforeHide = loads;

      await act(async () => render("hidden"));
      await act(async () => { await Promise.resolve(); });
      expect(before.disposed).toBe(true);

      await act(async () => render("visible"));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(current === before).toBe(false);
      expect(current.disposed).toBe(false);
      expect(host.textContent).toBe("loaded");
      expect(loads).toBeGreaterThan(loadsBeforeHide);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
