import { act, Component, createElement, StrictMode, Suspense, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { atom, subscribeStreamixDevtools, type Writable } from "@epikodelabs/streamix";
import {
  atomRef,
  createAtomSnapshot,
  createResource,
  hydrateAtomSnapshot,
  hydrateAtomPayload,
  hydrateAtomSnapshotFromDocument,
  parseAtomSnapshot,
  read,
  serializeAtomSnapshot,
  renderAtomSnapshotScript,
  useAtom,
  useAtomValue,
  usePreloadedResource,
  useResource,
  useStreamixAfterCommit,
  useStreamixSource,
  useWritable,
  write,
  __streamixTrace,
} from "../lib/runtime";
import { recordStreamixDevtoolsEvent, StreamixDevtools, ɵsetStreamixDevtoolsEnabled } from "../lib/devtools";
import { idescribe } from "./env.spec";

idescribe("React runtime escape hatches", () => {
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

  it("keeps an explicit local atom stable across ordinary re-renders", () => {
    const seen: Writable<number>[] = [];

    function Counter() {
      const [render, setRender] = useState(0);
      const count = useAtom(() => atom(0));
      seen.push(count);
      return createElement("button", { onClick: () => setRender(render + 1) }, String(render));
    }

    act(() => root.render(createElement(Counter)));
    act(() => container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("keeps a useAtom-owned atom writable through Strict Mode's mount-cleanup-remount cycle", async () => {
    let owned!: Writable<number>;

    function Counter() {
      owned = useAtom(() => atom(0));
      return createElement("output", null, String(owned.value));
    }

    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Counter)));
      await Promise.resolve();
    });

    expect(container.textContent).toBe("0");
    expect(owned.disposed).toBe(false);
    // A disposed atom ignores writes, so this only passes if the simulated
    // Strict-Mode teardown never disposed the committed instance.
    act(() => owned.next(1));
    expect(owned.value).toBe(1);

    act(() => root.unmount());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(owned.disposed).toBe(true);
  });

  it("keeps useResource live through Strict Mode's effect replay", async () => {
    let resolve!: (value: string) => void;
    let resource!: ReturnType<typeof useResource<string>>;

    function View() {
      resource = useResource(
        () => new Promise<string>(complete => { resolve = complete; }),
        [],
      );
      return createElement("output", null, resource.status);
    }

    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(View)));
      await Promise.resolve();
    });
    resolve("ready");
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(resource.status).toBe("ready");
  });

  it("provides explicit read, write, reference, and SSR snapshot APIs", () => {
    const status = atom("Saved");
    const count = atom(1);

    expect(atomRef(status)).toBe(status);
    expect(read(status)).toBe("Saved");
    write(status, "Updated");
    expect(read(status)).toBe("Updated");

    const snapshot = createAtomSnapshot({ status, count });
    write(status, "Local");
    write(count, 9);
    hydrateAtomSnapshot({ status, count }, snapshot);

    expect(status.value).toBe("Updated");
    expect(count.value).toBe(1);
  });

  it("rejects unknown snapshot keys without partially hydrating targets", () => {
    const first = atom("first");
    const second = atom("second");
    expect(() => hydrateAtomSnapshot({ first, second }, { first: "changed", extra: true }))
      .toThrowError(/Unknown atom snapshot key: extra/);
    expect(first.value).toBe("first");
    expect(second.value).toBe("second");
  });

  it("uses the same concurrent-safe snapshot bridge without the compiler", () => {
    const count = atom(0);
    function Counter() {
      return createElement("output", null, String(useAtomValue(count)));
    }

    act(() => root.render(createElement(Counter)));
    act(() => count.next(1));
    expect(container.textContent).toBe("1");
  });

  it("supports functional useWritable updates", () => {
    const count = atom(1);
    let update!: (next: number | ((previous: number) => number)) => void;
    function Counter() {
      [, update] = useWritable(count);
      return null;
    }
    act(() => root.render(createElement(Counter)));
    act(() => update(previous => previous + 1));
    expect(count.value).toBe(2);
  });

  it("re-renders explicit reads when a source emits the same object reference", () => {
    const item = { count: 0 };
    const model = atom(item);
    let renders = 0;
    function View() {
      const value = useAtomValue(model);
      renders++;
      return createElement("output", null, String(value.count));
    }
    act(() => root.render(createElement(View)));
    const before = renders;
    act(() => { item.count = 7; model.next(item); });
    expect(container.textContent).toBe("7");
    expect(renders).toBeGreaterThan(before);
  });

  it("keeps dedupe contracts per read mode regardless of subscription order", () => {
    for (const compilerFirst of [true, false]) {
      const item = { count: 0 };
      const model = atom(item);
      const host = document.createElement("div");
      const scopedRoot = createRoot(host);
      try {
        function CompilerView() {
          const value = useStreamixSource(model, "model");
          return createElement("output", { id: "compiler" }, String(value.count));
        }
        function ExplicitView() {
          const value = useAtomValue(model);
          return createElement("output", { id: "explicit" }, String(value.count));
        }
        const compiler = createElement(CompilerView, { key: "compiler" });
        const explicit = createElement(ExplicitView, { key: "explicit" });
        act(() => scopedRoot.render(createElement("div", null,
          compilerFirst ? compiler : explicit,
          compilerFirst ? explicit : compiler,
        )));

        item.count = 7;
        act(() => { model.next(item); });

        // The explicit read keeps its in-place mutation contract; the compiler
        // read keeps the equal-emission gate, in either subscription order.
        expect(host.querySelector("#explicit")?.textContent).toBe("7");
        expect(host.querySelector("#compiler")?.textContent).toBe("0");
      } finally {
        act(() => scopedRoot.unmount());
        host.remove();
      }
    }
  });

  it("handles a loader throwing synchronously as a resource error", async () => {
    const resource = createResource<string>(() => { throw new Error("loader failed"); });
    expect(() => resource.preload()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(resource.status).toBe("error");
    expect(() => resource.read()).toThrowError(/loader failed/);
  });

  it("uses explicitly preloaded resources for Suspense-safe loading and cancellation", async () => {
    let resolve!: (value: string) => void;
    let aborted = false;
    const resource = createResource(signal => new Promise<string>((complete) => {
      resolve = complete;
      signal.addEventListener("abort", () => { aborted = true; });
    }));

    expect(() => resource.read()).toThrowError(/has not been preloaded/);
    resource.preload();
    // The loader starts one microtask after preload(); let it run so the
    // executor assigns the completion callback used below.
    await Promise.resolve();
    let pending: Promise<void> | undefined;
    try { resource.read(); } catch (value) { pending = value as Promise<void>; }
    expect(pending instanceof Promise).toBe(true);

    resolve("Ready");
    await pending;
    expect(resource.status).toBe("ready");
    expect(resource.read()).toBe("Ready");

    resource.reload();
    expect(aborted).toBe(true);
    resource.dispose();
  });

  it("settles a mounted Suspense boundary when a pending resource is disposed", async () => {
    // The error boundary handling is the assertion; React's dev-mode error
    // log for the caught render error is expected and should not pollute the
    // test output.
    spyOn(console, "error");
    class Boundary extends Component<{ children?: ReactNode }, { message?: string }> {
      override state: { message?: string } = {};
      static getDerivedStateFromError(error: unknown) {
        return { message: error instanceof Error ? error.message : String(error) };
      }
      override render() { return this.state.message ? createElement("output", null, this.state.message) : this.props.children; }
    }
    const resource = createResource<string>(() => new Promise<string>(() => {}));
    resource.preload();
    function View() {
      const state = usePreloadedResource(resource);
      return createElement("output", null, state.read());
    }
    await act(async () => {
      root.render(createElement(Boundary, null,
        createElement(Suspense, { fallback: createElement("span", null, "loading") }, createElement(View))));
      await Promise.resolve();
    });
    expect(container.textContent).toBe("loading");

    await act(async () => { resource.dispose(); await Promise.resolve(); });
    expect(resource.status).toBe("error");
    expect(container.textContent).toContain("disposed before it settled");
  });

  it("keeps settled data when a ready resource is disposed", async () => {
    let resolve!: (value: string) => void;
    const resource = createResource<string>(() => new Promise<string>(complete => { resolve = complete; }));
    resource.preload();
    function View() {
      const state = usePreloadedResource(resource);
      return createElement("output", null, state.read());
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const localRoot = createRoot(host);
    try {
      await act(async () => {
        localRoot.render(createElement(Suspense, { fallback: createElement("span", null, "loading") }, createElement(View)));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(host.textContent).toBe("loading");
      await act(async () => { resolve("Ready"); await Promise.resolve(); await Promise.resolve(); });
      expect(host.textContent).toBe("Ready");

      act(() => resource.dispose());
      expect(resource.status).toBe("ready");
      expect(resource.read()).toBe("Ready");
      expect(host.textContent).toBe("Ready");
    } finally {
      act(() => localRoot.unmount());
      host.remove();
      resource.dispose();
    }
  });

  it("serializes, validates, and hydrates a versioned SSR payload", () => {
    const serverTitle = atom("<Saved>");
    const serialized = serializeAtomSnapshot({ title: serverTitle });
    const payload = parseAtomSnapshot(serialized);
    const clientTitle = atom("Client default");

    expect(serialized).toContain("\\u003cSaved\\u003e");
    hydrateAtomPayload({ title: clientTitle }, payload);
    expect(clientTitle.value).toBe("<Saved>");
    expect(() => hydrateAtomPayload({ other: clientTitle }, payload)).toThrowError(/keys do not match/);
    expect(() => parseAtomSnapshot('{"version":3,"atoms":{}}')).toThrowError(/Invalid Streamix atom snapshot payload/);
  });

  it("preserves undefined keys, rejects lossy snapshot values, and reads legacy payloads", () => {
    const explicitUndefined = atom<unknown>(undefined);
    const nested = atom({ list: [1, { ok: true }] });
    const payload = parseAtomSnapshot(serializeAtomSnapshot({ explicitUndefined, nested }));
    expect(payload.version).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(payload.atoms, "explicitUndefined")).toBeTrue();
    expect(payload.atoms['explicitUndefined']).toBeUndefined();
    expect(payload.atoms['nested']).toEqual({ list: [1, { ok: true }] });

    const targetUndefined = atom<unknown>("initial");
    const targetNested = atom<unknown>(null);
    hydrateAtomPayload({ explicitUndefined: targetUndefined, nested: targetNested }, payload);
    expect(targetUndefined.value).toBeUndefined();
    expect(targetNested.value).toEqual({ list: [1, { ok: true }] });

    // Version 1 payloads remain readable for stale server documents.
    const legacy = parseAtomSnapshot('{"version":1,"atoms":{"title":"Legacy"}}');
    expect(legacy.version).toBe(1);
    const legacyTarget = atom("initial");
    hydrateAtomPayload({ title: legacyTarget }, legacy);
    expect(legacyTarget.value).toBe("Legacy");

    for (const value of [NaN, Infinity, -Infinity, new Date(0), new Map(), new Set([1]), 10n, Symbol("x"), () => 1]) {
      expect(() => serializeAtomSnapshot({ bad: atom<unknown>(value) })).toThrowError(/not serializable/);
    }
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => serializeAtomSnapshot({ cyclic: atom<unknown>(cyclic) })).toThrowError(/circular reference/);
    expect(() => serializeAtomSnapshot({ nestedUndefined: atom<unknown>({ skip: undefined }) })).toThrowError(/contains undefined/);
    expect(() => serializeAtomSnapshot({ nonFinite: atom<unknown>([1, NaN]) })).toThrowError(/not serializable/);
    expect(() => parseAtomSnapshot('{"version":2,"atoms":{"bad":{"t":"date","v":0}}}')).toThrowError(/Invalid Streamix atom snapshot payload/);
  });

  it("transfers a validated SSR payload through a non-executable document element", () => {
    const serverTitle = atom("Saved");
    container.innerHTML = renderAtomSnapshotScript({ title: serverTitle }, "streamix-state");
    const clientTitle = atom("Client default");

    hydrateAtomSnapshotFromDocument({ title: clientTitle }, "streamix-state", document);

    expect(clientTitle.value).toBe("Saved");
    expect(container.querySelector("#streamix-state")).toBeNull();
    expect(() => renderAtomSnapshotScript({ title: serverTitle }, "not valid")).toThrowError(/id must contain/);
  });

  it("renders an opt-in DevTools trace", async () => {
    act(() => root.render(createElement(StreamixDevtools)));
    await act(async () => {
      recordStreamixDevtoolsEvent({ type: "write", source: "title" });
      await Promise.resolve();
    });
    expect(container.textContent).toContain("write: title");
  });

  it("renders no DevTools panel in production builds", async () => {
    ɵsetStreamixDevtoolsEnabled(false);
    try {
      act(() => root.render(createElement(StreamixDevtools)));
      expect(container.querySelector("[data-streamix-devtools]")).toBeNull();
    } finally {
      ɵsetStreamixDevtoolsEnabled(true);
    }
  });
});

idescribe("React tracing parity with the Angular layer", () => {
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

  it("skips re-renders and write events for equal-value emissions", async () => {
    const count = atom(1);
    const renders: number[] = [];
    const events: string[] = [];
    const stop = subscribeStreamixDevtools(event => {
      if (event.type === "write" || event.type === "render") events.push(`${event.type}:${event.source}`);
    });
    function Counter() {
      const value = useStreamixSource(count, "count");
      useStreamixAfterCommit(() => __streamixTrace("render", "Counter"));
      renders.push(value);
      return createElement("output", null, String(value));
    }
    try {
      act(() => root.render(createElement(Counter)));
      act(() => count.set(1)); // equal value: no re-render, no write event
      await act(async () => { count.set(2); await Promise.resolve(); }); // changed value: one write, one gated render
      expect(renders).toEqual([1, 2]);
      expect(events).toEqual(["write:count", "render:Counter"]);
    } finally {
      stop();
    }
  });

  it("does not trace renders for commits without writes", async () => {
    const count = atom(1);
    const events: string[] = [];
    const stop = subscribeStreamixDevtools(event => {
      if (event.type === "render") events.push(event.source);
    });
    function Counter() {
      useStreamixSource(count, "count");
      useStreamixAfterCommit(() => __streamixTrace("render", "Counter"));
      return createElement("output", null, "static");
    }
    try {
      await act(async () => { root.render(createElement(Counter)); await Promise.resolve(); });
      expect(events).toEqual([]);
    } finally {
      stop();
    }
  });

  it("attributes a batched commit to the component that owns the write", async () => {
    const left = atom(0);
    const right = atom(0);
    const events: string[] = [];
    const stop = subscribeStreamixDevtools(event => {
      if (event.type === "write" || event.type === "render") events.push(`${event.type}:${event.source}`);
    });
    let rerenderParent!: () => void;
    function Left() {
      const value = useStreamixSource(left, "left");
      useStreamixAfterCommit(() => __streamixTrace("render", "Left"), [left]);
      return createElement("output", null, String(value));
    }
    function Right() {
      const value = useStreamixSource(right, "right");
      useStreamixAfterCommit(() => __streamixTrace("render", "Right"), [right]);
      return createElement("output", null, String(value));
    }
    function Parent() {
      const [, setVersion] = useState(0);
      rerenderParent = () => setVersion(version => version + 1);
      return createElement("div", null, createElement(Left), createElement(Right));
    }
    try {
      await act(async () => { root.render(createElement(Parent)); await Promise.resolve(); });
      events.length = 0;
      // Both components commit in one batch; Left's effect runs first even
      // though Right owns the write.
      await act(async () => {
        right.next(2);
        rerenderParent();
        await Promise.resolve();
      });
      expect(events).toEqual(["write:right", "render:Right"]);
    } finally {
      stop();
    }
  });

  it("traces a render for an equal-reference emission on a mixed-dedupe source", async () => {
    const state = atom({ count: 1 });
    const events: string[] = [];
    const stop = subscribeStreamixDevtools(event => {
      if (event.type === "write" || event.type === "render") events.push(`${event.type}:${event.source}`);
    });
    function Mixed() {
      // Explicit hooks keep the dedupe-off entry: the same reference still
      // notifies and re-renders. The compiler binding uses its own entry.
      useAtomValue(state);
      useStreamixSource(state, "state");
      useStreamixAfterCommit(() => __streamixTrace("render", "Mixed"), [state]);
      return createElement("output", null, String(state.value.count));
    }
    try {
      await act(async () => { root.render(createElement(Mixed)); await Promise.resolve(); });
      events.length = 0;
      await act(async () => { state.next(state.value); await Promise.resolve(); });
      expect(events).toEqual(["write:explicit atom read", "render:Mixed"]);
    } finally {
      stop();
      state.dispose();
    }
  });

  it("traces escape-hatch reads and writes without attributing a render", async () => {
    const source = atom(1);
    const events: string[] = [];
    const stop = subscribeStreamixDevtools(event => {
      if (event.type === "read" || event.type === "write" || event.type === "render") {
        events.push(`${event.type}:${event.source}`);
      }
    });
    try {
      await act(async () => {
        expect(read(source)).toBe(1);
        write(source, 2);
        // The hatch write is an event, not a write count: a following legacy
        // render trace stays unattributed.
        __streamixTrace("render", "Ghost");
        await Promise.resolve();
      });
      // Vue parity: the same types and labels as the Vue adapter's hatches.
      expect(events).toEqual(["read:explicit atom read", "write:explicit atom write"]);
      expect(source.value).toBe(2);
    } finally {
      stop();
      source.dispose();
    }
  });
});
