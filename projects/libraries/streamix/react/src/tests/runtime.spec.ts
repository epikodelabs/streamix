import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { atom, type Writable } from "@epikodelabs/streamix";
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
  write,
} from "../lib/runtime";
import { recordStreamixDevtoolsEvent, StreamixDevtools } from "../lib/devtools";

describe("React runtime escape hatches", () => {
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

  it("uses the same concurrent-safe snapshot bridge without the compiler", () => {
    const count = atom(0);
    function Counter() {
      return createElement("output", null, String(useAtomValue(count)));
    }

    act(() => root.render(createElement(Counter)));
    act(() => count.next(1));
    expect(container.textContent).toBe("1");
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

  it("serializes, validates, and hydrates a versioned SSR payload", () => {
    const serverTitle = atom("<Saved>");
    const serialized = serializeAtomSnapshot({ title: serverTitle });
    const payload = parseAtomSnapshot(serialized);
    const clientTitle = atom("Client default");

    expect(serialized).toContain("\\u003cSaved\\u003e");
    hydrateAtomPayload({ title: clientTitle }, payload);
    expect(clientTitle.value).toBe("<Saved>");
    expect(() => hydrateAtomPayload({ other: clientTitle }, payload)).toThrowError(/keys do not match/);
    expect(() => parseAtomSnapshot('{"version":2,"atoms":{}}')).toThrowError(/Invalid Streamix atom snapshot payload/);
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
});
