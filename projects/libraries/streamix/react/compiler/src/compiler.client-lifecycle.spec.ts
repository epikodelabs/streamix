import { StrictMode, Suspense, act, createElement } from "react";
import * as React from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import * as streamixReact from "@epikodelabs/streamix/react";
import ts from "typescript";
import { atom, scope, type Writable } from "@epikodelabs/streamix";
import { transformReactJsx } from "./compiler";
import { idescribe } from "../../src/tests/env.spec";

type CompiledModule = {
  App: () => ReturnType<typeof createElement>;
  status?: Writable<string>;
};

function compileGeneratedModule(
  source: string,
  atomFactory: (value: unknown) => Writable<unknown> = atom,
  scopeFactory: (config: Record<string, unknown>) => ReturnType<typeof scope> = scope,
): CompiledModule {
  const generated = transformReactJsx(source, "client-component.tsx");
  const javascript = ts.transpileModule(generated.code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: "client-component.tsx",
  }).outputText;
  const module = { exports: {} as CompiledModule };
  const require = (name: string): unknown => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "@epikodelabs/streamix/react") return streamixReact;
    if (name === "@epikodelabs/streamix") return { atom: atomFactory, scope: scopeFactory };
    throw new Error(`Unexpected generated import: ${name}`);
  };

  // Generated adapters extend React.Component, so the eval'd module needs the
  // React namespace even though JSX itself compiles to the automatic runtime.
  new Function("React", "require", "module", "exports", javascript)(React, require, module, module.exports);
  return module.exports;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

idescribe("React JSX compiler client lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it("hydrates the server markup, receives updates, and unsubscribes on unmount", async () => {
    const module = compileGeneratedModule(`
      import { atom } from "@epikodelabs/streamix";
      export const status = atom("Saved");
      export function App() { return <output>{status}</output>; }
    `);
    container.innerHTML = "<output>Saved</output>";

    await act(async () => {
      root = hydrateRoot(container, createElement(module.App));
      await flushMicrotasks();
    });

    expect(container.textContent).toBe("Saved");
    expect(module.status!.subscriberCount).toBe(1);

    act(() => module.status!.next("Updated"));
    expect(container.textContent).toBe("Updated");

    act(() => root?.unmount());
    root = undefined;
    await flushMicrotasks();
    expect(module.status!.subscriberCount).toBe(0);
  });

  it("keeps a generated class adapter subscription until its wrapper unmounts", async () => {
    const module = compileGeneratedModule(`
      import { atom } from "@epikodelabs/streamix";
      export const status = atom("Saved");
      class Status extends React.Component {
        render() { return <output>{status}</output>; }
      }
      export function App() { return <Status />; }
    `);
    root = createRoot(container);

    await act(async () => {
      root!.render(createElement(module.App));
      await flushMicrotasks();
    });

    expect(container.textContent).toBe("Saved");
    expect(module.status!.subscriberCount).toBe(1);

    act(() => module.status!.next("Updated"));
    expect(container.textContent).toBe("Updated");

    act(() => root?.unmount());
    root = undefined;
    await flushMicrotasks();
    expect(module.status!.subscriberCount).toBe(0);
  });

  it("keeps a higher-order wrapped function component subscribed until unmount", async () => {
    const module = compileGeneratedModule(`
      import { atom } from "@epikodelabs/streamix";
      export const status = atom("Saved");
      const withTracking = <T,>(component: T) => component;
      export const App = withTracking(() => <output>{status}</output>);
    `);
    root = createRoot(container);

    await act(async () => {
      root!.render(createElement(module.App));
      await flushMicrotasks();
    });

    expect(container.textContent).toBe("Saved");
    expect(module.status!.subscriberCount).toBe(1);

    act(() => module.status!.next("Updated"));
    expect(container.textContent).toBe("Updated");

    act(() => root?.unmount());
    root = undefined;
    await flushMicrotasks();
    expect(module.status!.subscriberCount).toBe(0);
  });

  it("does not subscribe when a render is interrupted by Suspense before commit", async () => {
    const module = compileGeneratedModule(`
      import { atom } from "@epikodelabs/streamix";
      export const status = atom("Saved");
      function Blocker() { throw new Promise(() => {}); }
      export function App() { return <><output>{status}</output><Blocker /></>; }
    `);

    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(Suspense, { fallback: createElement("span", null, "Loading") }, createElement(module.App)));
      await flushMicrotasks();
    });

    expect(container.textContent).toBe("Loading");
    expect(module.status!.subscriberCount).toBe(0);
  });

  it("passes a shared atom reference through a component prop", async () => {
    const module = compileGeneratedModule(`
      import { atom } from "@epikodelabs/streamix";
      export const status = atom("Saved");
      function Child({ source }: { source: unknown }) {
        return <output>{typeof (source as { subscribe?: unknown }).subscribe}</output>;
      }
      export function App() { return <Child source={status} />; }
    `);

    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(module.App));
      await flushMicrotasks();
    });

    expect(container.textContent).toBe("function");
    expect(module.status!.subscriberCount).toBe(0);
  });

  it("keeps one subscription through Strict Mode's mount-cleanup-remount cycle", async () => {
    const module = compileGeneratedModule(`
      import { atom } from "@epikodelabs/streamix";
      export const status = atom("Saved");
      export function App() { return <output>{status}</output>; }
    `);
    root = createRoot(container);

    await act(async () => {
      root!.render(createElement(StrictMode, null, createElement(module.App)));
      await flushMicrotasks();
    });

    expect(container.textContent).toBe("Saved");
    expect(module.status!.subscriberCount).toBe(1);

    act(() => root?.unmount());
    root = undefined;
    await flushMicrotasks();
    expect(module.status!.subscriberCount).toBe(0);
  });

  it("keeps a compiler-owned local atom stable through reactive re-renders and disposes it", async () => {
    const created: Writable<unknown>[] = [];
    const module = compileGeneratedModule(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        let count = atom(0);
        return <button onClick={() => count += 1}>{count}</button>;
      }
    `, initial => {
      const instance = atom(initial);
      created.push(instance);
      return instance;
    });
    root = createRoot(container);

    await act(async () => {
      root!.render(createElement(module.App));
      await flushMicrotasks();
    });
    act(() => container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toBe("1");
    expect(created.length).toBe(1);

    act(() => root?.unmount());
    root = undefined;
    await flushMicrotasks();
    expect(created[0].disposed).toBe(true);
  });

  it("keeps a compiler-owned local scope stable through reactive re-renders and disposes it", async () => {
    const created: Array<ReturnType<typeof scope>> = [];
    const module = compileGeneratedModule(`
      import { scope } from "@epikodelabs/streamix";
      export function App() {
        const state = scope({ title: "Ready" });
        return <button onClick={() => state.title = "Updated"}>{state.title}</button>;
      }
    `, atom, (config: Record<string, unknown>) => {
      const instance = scope(config as Record<string, unknown>);
      created.push(instance);
      return instance;
    });
    root = createRoot(container);

    await act(async () => {
      root!.render(createElement(module.App));
      await flushMicrotasks();
    });
    act(() => container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toBe("Updated");
    expect(created.length).toBe(1);

    act(() => root?.unmount());
    root = undefined;
    await flushMicrotasks();
    expect(created[0]._disposed).toBe(true);
  });
});
