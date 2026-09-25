import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { atom } from "@epikodelabs/streamix";
import { useWritable } from "../src/lib/useWritable";

describe("useWritable", () => {
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

  it("reads the atom's value and writes back through setValue", () => {
    const counter = atom(0);

    function Widget() {
      const [count, setCount] = useWritable(counter);
      return createElement(
        "button",
        { onClick: () => setCount(count + 1) },
        String(count),
      );
    }

    act(() => root.render(createElement(Widget)));
    expect(container.textContent).toBe("0");

    const button = container.querySelector("button")!;
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toBe("1");
    expect(counter.value).toBe(1);
  });

  it("stays in sync when the atom is updated from outside the component", () => {
    const counter = atom(0);

    function Widget() {
      const [count] = useWritable(counter);
      return createElement("span", null, String(count));
    }

    act(() => root.render(createElement(Widget)));
    act(() => counter.next(5));

    expect(container.textContent).toBe("5");
  });
});
