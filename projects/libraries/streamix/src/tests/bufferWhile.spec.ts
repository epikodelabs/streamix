import {
    bufferWhile,
    atom,
    fromAtom,
    type Atom,
} from "@epikodelabs/streamix";

const waitTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("bufferWhile", () => {
  it("flushes the buffer when the predicate resolves truthy", async () => {
    const source$: Atom<number> = atom<number>();
    const subject = fromAtom(source$);
    const results: number[][] = [];
    const buffered = subject.pipe(bufferWhile((_value, _index, buffer) => buffer.length < 3));

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3);
    await waitTick();

    source$.set(4);
    source$.set(5);
    source$.dispose();
    await waitTick();

    expect(results).toEqual([[1, 2, 3], [4, 5]]);
  });

  it("emits the trailing buffer when the source completes", async () => {
    const source$: Atom<number> = atom<number>();
    const subject = fromAtom(source$);
    const results: number[][] = [];
    const buffered = subject.pipe(bufferWhile(() => false));

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set(9);
    source$.dispose();
    await waitTick();

    expect(results).toEqual([[9]]);
  });

  it("supports index parameter in predicate", async () => {
    const source$: Atom<number> = atom<number>();
    const subject = fromAtom(source$);
    const results: number[][] = [];
    const indices: number[] = [];
    const buffered = subject.pipe(
      bufferWhile((_value, index, buffer) => {
        indices.push(index);
        return buffer.length < 3; // Flush when buffer size reaches 3
      })
    );

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set(10);
    source$.set(20);
    source$.set(30);
    await waitTick();

    source$.set(40);
    source$.dispose();
    await waitTick();

    expect(results).toEqual([[10, 20, 30], [40]]);
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it("uses index to flush based on value position", async () => {
    const source$: Atom<string> = atom<string>();
    const subject = fromAtom(source$);
    const results: string[][] = [];
    const buffered = subject.pipe(
      bufferWhile((_value, index) => index < 2) // Flush after 2 values
    );

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set("a");
    source$.set("b");
    await waitTick();

    source$.set("c");
    source$.dispose();
    await waitTick();

    expect(results).toEqual([["a", "b"], ["c"]]);
  });

  it("supports async predicates", async () => {
    const source$: Atom<number> = atom<number>();
    const subject = fromAtom(source$);
    const results: number[][] = [];
    const buffered = subject.pipe(
      bufferWhile((_value, _index, buffer) => Promise.resolve(buffer.length < 2))
    );

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    await waitTick();

    source$.set(3);
    source$.dispose();
    await waitTick();

    expect(results).toEqual([[1, 2], [3]]);
  });

  it("does not emit when source completes without values", async () => {
    const source$: Atom<number> = atom<number>();
    const subject = fromAtom(source$);
    const results: number[][] = [];
    const buffered = subject.pipe(bufferWhile(() => true));

    void (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    source$.dispose();
    await waitTick();

    expect(results).toEqual([]);
  });

});
