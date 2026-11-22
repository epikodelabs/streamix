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
  attrs?: Writable<Record<string, unknown>>;
  assignmentResult?: unknown;
  assignmentCalls?: number;
  orValue?: Writable<number | null>;
  andValue?: Writable<number | null>;
  nullishValue?: Writable<number | null>;
  rhsCalls?: number;
  runOr?: (value: number) => Promise<number | null>;
  runAnd?: (value: number) => Promise<number | null>;
  runNullish?: (value: number) => Promise<number | null>;
  yieldOr?: (initial: number) => Generator<number, number | null, number>;
  yieldAnd?: (initial: number) => Generator<number, number | null, number>;
  yieldNullish?: (initial: number) => Generator<number, number | null, number>;
};

const LOGICAL_ATOM_SOURCE = `
  import { atom } from "@epikodelabs/streamix";
  export let orValue = atom<number | null>(0);
  export let andValue = atom<number | null>(2);
  export let nullishValue = atom<number | null>(null);
  export let rhsCalls = 0;
  async function rhs(value: number) { rhsCalls++; await Promise.resolve(); return value; }
  export async function runOr(value: number) { return orValue ||= await rhs(value); }
  export async function runAnd(value: number) { return andValue &&= await rhs(value); }
  export async function runNullish(value: number) { return nullishValue ??= await rhs(value); }
  export function* yieldOr(initial: number) { return orValue ||= yield initial; }
  export function* yieldAnd(initial: number) { return andValue &&= yield initial; }
  export function* yieldNullish(initial: number) { return nullishValue ??= yield initial; }
  export function App() { return <output>{String(orValue)}</output>; }
`;

function disposeLogicalAtoms(module: CompiledModule): void {
  module.orValue!.dispose();
  module.andValue!.dispose();
  module.nullishValue!.dispose();
}

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

  it("subscribes to explicit atom reads that decide an eager render branch", async () => {
    const count = atom(0);
    const module = compileGeneratedModule(`
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      export function App() {
        if (count.value === 0) return <output>zero</output>;
        return <output>one</output>;
      }
    `, () => count as Writable<unknown>);
    await act(async () => { root = createRoot(container); root.render(createElement(module.App)); });
    expect(container.textContent).toBe("zero");
    await act(async () => { count.next(1); });
    expect(container.textContent).toBe("one");
    await count.dispose();
  });

  it("updates object value fields that share names with source APIs", async () => {
    const form = atom({ error: "bad" });
    const module = compileGeneratedModule(`
      import { atom } from '@epikodelabs/streamix';
      const form = atom({ error: "bad" });
      export function App() { return <output>{form.error}</output>; }
    `, () => form as Writable<unknown>);
    await act(async () => { root = createRoot(container); root.render(createElement(module.App)); });
    expect(container.textContent).toBe("bad");
    await act(async () => { form.next({ error: "fixed" }); });
    expect(container.textContent).toBe("fixed");
    form.dispose();
  });

  it("keeps assignment callback results while updating the rendered atom", async () => {
    const module = compileGeneratedModule(`
      import { atom } from '@epikodelabs/streamix';
      export let status = atom('initial');
      export let assignmentResult;
      export let assignmentCalls = 0;
      function nextValue() { assignmentCalls++; return 'updated'; }
      export function App() {
        return <button onClick={() => {
          const assign = () => status = nextValue();
          assignmentResult = assign();
        }}>{status}</button>;
      }
    `);
    const original = module.status;
    await act(async () => { root = createRoot(container); root.render(createElement(module.App)); });
    expect(container.textContent).toBe('initial');
    act(() => container.querySelector('button')!.click());
    expect(container.textContent).toBe('updated');
    expect(module.assignmentResult).toBe('updated');
    expect(module.assignmentCalls).toBe(1);
    expect(module.status).toBe(original);
    act(() => root?.unmount());
    root = undefined;
    module.status!.dispose();
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

  it("notifies the source and re-renders a class handler using an explicit atom write", async () => {
    const module = compileGeneratedModule(`
      import { atom } from '@epikodelabs/streamix';
      export const status = atom('Saved');
      class Status extends React.Component {
        render() { return <button onClick={() => status.next(status + '!')}>{status.value}</button>; }
      }
      export function App() { return <Status />; }
    `);
    const emissions: string[] = [];
    const stop = module.status!.subscribe(value => emissions.push(value));
    root = createRoot(container);
    await act(async () => { root!.render(createElement(module.App)); await flushMicrotasks(); });
    expect(container.textContent).toBe('Saved');
    act(() => container.querySelector('button')!.click());
    expect(module.status!.value).toBe('Saved!');
    expect(emissions).toEqual(['Saved', 'Saved!']);
    expect(container.textContent).toBe('Saved!');
    act(() => container.querySelector('button')!.click());
    expect(container.textContent).toBe('Saved!!');
    expect(emissions).toEqual(['Saved', 'Saved!', 'Saved!!']);
    act(() => root?.unmount());
    root = undefined;
    stop();
    module.status!.dispose();
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
    act(() => container.querySelector("button")!.click());

    expect(container.textContent).toBe("1");
    expect(created.length).toBe(1);

    act(() => root?.unmount());
    root = undefined;
    await flushMicrotasks();
    expect(created[0].disposed).toBe(true);
  });

  it("keeps nested assignment targets bound to their atoms", async () => {
    const module = compileGeneratedModule(`
      import { atom } from "@epikodelabs/streamix";
      export function App() {
        let a = atom(0);
        let b = atom(0);
        return <button onClick={() => { a = b = 1; b = b.value + 1; }}>{a}:{b}</button>;
      }
    `);
    root = createRoot(container);

    await act(async () => {
      root!.render(createElement(module.App));
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("0:0");

    act(() => container.querySelector("button")!.click());
    expect(container.textContent).toBe("1:2");
  });

  it("keeps a reactive attribute spread subscribed to its atom", async () => {
    const module = compileGeneratedModule(`
      import { atom } from "@epikodelabs/streamix";
      export const attrs = atom({ title: "one" });
      export function App() { return <div {...attrs} />; }
    `);
    root = createRoot(container);

    await act(async () => { root!.render(createElement(module.App)); await flushMicrotasks(); });
    const view = container.querySelector("div")!;
    expect(view.getAttribute("title")).toBe("one");

    await act(async () => { module.attrs!.next({ title: "two" }); await flushMicrotasks(); });
    expect(view.getAttribute("title")).toBe("two");

    act(() => root?.unmount());
    root = undefined;
    module.attrs!.dispose();
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
    act(() => container.querySelector("button")!.click());

    expect(container.textContent).toBe("Updated");
    expect(created.length).toBe(1);

    act(() => root?.unmount());
    root = undefined;
    await flushMicrotasks();
    expect(created[0]._disposed).toBe(true);
  });

  it("keeps awaited logical assignments in the async context and preserves results", async () => {
    const module = compileGeneratedModule(LOGICAL_ATOM_SOURCE);
    const orValue = module.orValue!;
    const andValue = module.andValue!;
    const nullishValue = module.nullishValue!;
    try {
      // Falsy, truthy and nullish current values assign through the RHS.
      expect(await module.runOr!(10)).toBe(10);
      expect(orValue.value).toBe(10);
      expect(await module.runAnd!(20)).toBe(20);
      expect(andValue.value).toBe(20);
      expect(await module.runNullish!(30)).toBe(30);
      expect(nullishValue.value).toBe(30);
      expect(module.rhsCalls).toBe(3);
      // Writes keep the exported atom identity.
      expect(module.orValue).toBe(orValue);
      expect(orValue.disposed).toBe(false);

      // Truthy and non-nullish values short-circuit before the awaited RHS.
      expect(await module.runOr!(11)).toBe(10);
      expect(await module.runNullish!(31)).toBe(30);
      expect(module.rhsCalls).toBe(3);
      // &&= assigns while the current value is truthy.
      expect(await module.runAnd!(21)).toBe(21);
      expect(module.rhsCalls).toBe(4);

      // A falsy &&= operand skips the RHS and returns the current value.
      andValue.next(0);
      expect(await module.runAnd!(22)).toBe(0);
      expect(module.rhsCalls).toBe(4);
      // A falsy RHS is still written and returned by ||=.
      orValue.next(0);
      expect(await module.runOr!(0)).toBe(0);
      expect(orValue.value).toBe(0);
      expect(module.rhsCalls).toBe(5);
    } finally {
      disposeLogicalAtoms(module);
    }
  });

  it("keeps yielded logical assignments in the generator context and preserves results", () => {
    const module = compileGeneratedModule(LOGICAL_ATOM_SOURCE);
    const orValue = module.orValue!;
    const andValue = module.andValue!;
    const nullishValue = module.nullishValue!;
    try {
      // ||= yields only while the current value is falsy.
      orValue.next(0);
      const or = module.yieldOr!(1);
      expect(or.next()).toEqual({ value: 1, done: false });
      expect(or.next(5)).toEqual({ value: 5, done: true });
      expect(orValue.value).toBe(5);
      expect(module.yieldOr!(2).next()).toEqual({ value: 5, done: true });

      // &&= yields only while the current value is truthy.
      andValue.next(3);
      const and = module.yieldAnd!(3);
      expect(and.next()).toEqual({ value: 3, done: false });
      expect(and.next(9)).toEqual({ value: 9, done: true });
      expect(andValue.value).toBe(9);
      andValue.next(0);
      expect(module.yieldAnd!(4).next()).toEqual({ value: 0, done: true });
      expect(andValue.value).toBe(0);

      // ??= yields only while the current value is nullish.
      nullishValue.next(null);
      const nullish = module.yieldNullish!(5);
      expect(nullish.next()).toEqual({ value: 5, done: false });
      expect(nullish.next(8)).toEqual({ value: 8, done: true });
      expect(nullishValue.value).toBe(8);
      nullishValue.next(0);
      expect(module.yieldNullish!(6).next()).toEqual({ value: 0, done: true });
      expect(nullishValue.value).toBe(0);
      expect(module.orValue).toBe(orValue);
    } finally {
      disposeLogicalAtoms(module);
    }
  });
});
