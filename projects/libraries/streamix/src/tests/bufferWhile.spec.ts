import {
  bufferWhile,
  createOperator,
  createSubject,
  getIteratorMeta,
  getValueMeta,
  setIteratorMeta,
} from "@epikodelabs/streamix";

const waitTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("bufferWhile", () => {
  it("flushes the buffer when the predicate resolves truthy", async () => {
    const subject = createSubject<number>();
    const results: number[][] = [];
    const buffered = subject.pipe(bufferWhile((_value, _index, buffer) => buffer.length < 3));

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    await waitTick();

    subject.next(4);
    subject.next(5);
    subject.complete();
    await waitTick();

    expect(results).toEqual([[1, 2, 3], [4, 5]]);
  });

  it("emits the trailing buffer when the source completes", async () => {
    const subject = createSubject<number>();
    const results: number[][] = [];
    const buffered = subject.pipe(bufferWhile(() => false));

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(9);
    subject.complete();
    await waitTick();

    expect(results).toEqual([[9]]);
  });

  it("supports index parameter in predicate", async () => {
    const subject = createSubject<number>();
    const results: number[][] = [];
    const indices: number[] = [];
    const buffered = subject.pipe(
      bufferWhile((_value, index, buffer) => {
        indices.push(index);
        return buffer.length < 3; // Flush when buffer size reaches 3
      })
    );

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(10);
    subject.next(20);
    subject.next(30);
    await waitTick();

    subject.next(40);
    subject.complete();
    await waitTick();

    expect(results).toEqual([[10, 20, 30], [40]]);
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it("uses index to flush based on value position", async () => {
    const subject = createSubject<string>();
    const results: string[][] = [];
    const buffered = subject.pipe(
      bufferWhile((_value, index) => index < 2) // Flush after 2 values
    );

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next("a");
    subject.next("b");
    await waitTick();

    subject.next("c");
    subject.complete();
    await waitTick();

    expect(results).toEqual([["a", "b"], ["c"]]);
  });

  it("supports async predicates", async () => {
    const subject = createSubject<number>();
    const results: number[][] = [];
    const buffered = subject.pipe(
      bufferWhile((_value, _index, buffer) => Promise.resolve(buffer.length < 2))
    );

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    await waitTick();

    subject.next(3);
    subject.complete();
    await waitTick();

    expect(results).toEqual([[1, 2], [3]]);
  });

  it("does not emit when source completes without values", async () => {
    const subject = createSubject<number>();
    const results: number[][] = [];
    const buffered = subject.pipe(bufferWhile(() => true));

    (async () => {
      for await (const value of buffered) {
        results.push(value);
      }
    })();

    subject.complete();
    await waitTick();

    expect(results).toEqual([]);
  });

  it("attaches collapse metadata when upstream iterator has meta", async () => {
    const tagIds = createOperator<number, number>("tagIds", function (source) {
      let n = 0;
      const iterator: AsyncIterator<number> = {
        next: async () => {
          const result = await source.next();
          if (result.done) return result;

          n += 1;
          setIteratorMeta(iterator as any, { valueId: `id${n}` }, 0, "tagIds");
          return result;
        },
      };
      return iterator;
    });

    const subject = createSubject<number>();
    const buffered = subject.pipe(
      tagIds,
      bufferWhile((_value, _index, buf) => buf.length < 2)
    );

    const it = buffered[Symbol.asyncIterator]();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.complete();
    await waitTick();

    const r1 = await it.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual([1, 2]);

    expect(getIteratorMeta(it as any)).toEqual(
      jasmine.objectContaining({
        valueId: "id2",
        kind: "collapse",
        inputValueIds: ["id1", "id2"],
      })
    );
    expect(getValueMeta(r1.value)).toEqual(
      jasmine.objectContaining({
        valueId: "id2",
        kind: "collapse",
        inputValueIds: ["id1", "id2"],
      })
    );

    const r2 = await it.next();
    expect(r2.done).toBe(false);
    expect(r2.value).toEqual([3]);

    expect(getValueMeta(r2.value)).toEqual(
      jasmine.objectContaining({
        valueId: "id3",
        kind: "collapse",
        inputValueIds: ["id3"],
      })
    );

    const r3 = await it.next();
    expect(r3.done).toBe(true);
    const r4 = await it.next();
    expect(r4.done).toBe(true);
  });
});
