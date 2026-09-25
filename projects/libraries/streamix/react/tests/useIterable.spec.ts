import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { atom, type Atom } from "@epikodelabs/streamix";
import { useIterable } from "../src/lib/useIterable";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useIterable", () => {
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

  describe("given an existing atom", () => {
    it("renders the atom's current value", () => {
      const count = atom(0);

      function Counter() {
        const value = useIterable(count);
        return createElement("span", null, String(value));
      }

      act(() => root.render(createElement(Counter)));
      expect(container.textContent).toBe("0");
    });

    it("re-renders when the atom emits", () => {
      const count = atom(0);

      function Counter() {
        const value = useIterable(count);
        return createElement("span", null, String(value));
      }

      act(() => root.render(createElement(Counter)));
      act(() => count.next(1));

      expect(container.textContent).toBe("1");
    });

    it("unsubscribes on unmount", () => {
      const count = atom(0);

      function Counter() {
        const value = useIterable(count);
        return createElement("span", null, String(value));
      }

      act(() => root.render(createElement(Counter)));
      expect(count.subscriberCount).toBe(1);

      act(() => root.unmount());
      expect(count.subscriberCount).toBe(0);
    });
  });

  describe("given a factory (owned lifecycle)", () => {
    it("creates the atom lazily and never disposes an externally-owned one", async () => {
      const status = atom<"online" | "offline">("offline");

      function Widget() {
        const value = useIterable(status);
        return createElement("span", null, value);
      }

      act(() => root.render(createElement(Widget)));
      expect(container.textContent).toBe("offline");

      act(() => status.next("online"));
      expect(container.textContent).toBe("online");

      act(() => root.unmount());
      await flushMicrotasks();
      expect(status.disposed).toBe(false);
    });

    it("owns and disposes a factory-created atom on unmount", async () => {
      let created!: Atom<number>;

      function Widget() {
        const value = useIterable(() => {
          const a = atom(0);
          created = a;
          return a;
        });
        return createElement("span", null, String(value));
      }

      act(() => root.render(createElement(Widget)));
      expect(created.disposed).toBe(false);

      act(() => root.unmount());
      await flushMicrotasks();
      expect(created.disposed).toBe(true);
    });

    it("falls back to initialValue until the owned atom has a value", () => {
      function Widget() {
        const value = useIterable(() => atom<number | undefined>(undefined), -1);
        return createElement("span", null, String(value));
      }

      act(() => root.render(createElement(Widget)));
      expect(container.textContent).toBe("-1");
    });

    it("survives StrictMode's dev-only remount without disposing the owned atom", async () => {
      let created!: Atom<number>;

      function Widget() {
        const value = useIterable(() => {
          if (!created) created = atom(0);
          return created;
        });
        return createElement("span", null, String(value));
      }

      act(() =>
        root.render(createElement(StrictMode, null, createElement(Widget))),
      );
      await flushMicrotasks();

      expect(created.disposed).toBe(false);
    });
  });

  describe("given a plain async iterable", () => {
    it("renders the initial value and then the latest emission", async () => {
      let emit!: (value: number) => void;

      async function* values() {
        while (true) {
          const value = await new Promise<number>((resolve) => {
            emit = resolve;
          });
          yield value;
        }
      }

      const source = values();

      function Widget() {
        const value = useIterable(source, -1);
        return createElement("span", null, String(value));
      }

      act(() => root.render(createElement(Widget)));
      expect(container.textContent).toBe("-1");

      await act(async () => {
        emit(7);
        await flushMicrotasks();
      });

      expect(container.textContent).toBe("7");
    });

    it("closes the iterator after unmount", async () => {
      let closed = false;
      const source: AsyncIterable<number> = {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<number>>(() => {}),
            return: async () => {
              closed = true;
              return { done: true, value: undefined };
            },
          };
        },
      };

      function Widget() {
        useIterable(source, 0);
        return null;
      }

      act(() => root.render(createElement(Widget)));
      act(() => root.unmount());
      await flushMicrotasks();

      expect(closed).toBe(true);
    });
  });

});
