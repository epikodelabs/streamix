import * as React from "react";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createStreamixLifetime, StreamixLifetimeProvider, useAtom } from "../lib/runtime";
import { atom, type Writable } from "@epikodelabs/streamix";
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
    function render(mode: "visible" | "hidden") {
      root.render(createElement(StreamixLifetimeProvider, { lifetime },
        createElement(StrictMode, null, createElement(Activity, { mode }, createElement(Counter)))));
    }
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
});
