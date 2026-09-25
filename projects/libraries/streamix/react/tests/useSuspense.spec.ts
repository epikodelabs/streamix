import { act, createElement, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { atom } from "@epikodelabs/streamix";
import { useSuspense } from "../src/lib/suspense";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useSuspense", () => {
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

  it("suspends until the first emission, then tracks later ones", async () => {
    const source = atom<number>(); // no initial value: not yet emitted

    function Reader() {
      const value = useSuspense(source);
      return createElement("span", null, String(value));
    }

    await act(async () => {
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "loading") },
          createElement(Reader),
        ),
      );
    });
    expect(container.textContent).toBe("loading");

    await act(async () => {
      source.next(1);
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("1");

    await act(async () => {
      source.next(2);
    });
    expect(container.textContent).toBe("2");
  });

  it("does not suspend when the atom already has a value", async () => {
    const source = atom(7);

    function Reader() {
      const value = useSuspense(source);
      return createElement("span", null, String(value));
    }

    await act(async () => {
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "loading") },
          createElement(Reader),
        ),
      );
    });

    expect(container.textContent).toBe("7");
  });
});
