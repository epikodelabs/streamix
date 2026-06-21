import { atom, bufferWhile, iterate, pipe, type Writable } from '@epikodelabs/streamix';

const waitTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("bufferWhile", () => {
  it("flushes the buffer when the predicate resolves truthy", async () => {
    const subject: Writable<any> = atom<number>();
    const results: number[][] = [];
    const buffered = pipe(subject, bufferWhile((_value, _index, buffer) => buffer.length < 3));

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    await waitTick();

    subject.next(4);
    subject.next(5);
    subject.dispose();
    await waitTick();
    await completed;

    expect(results).toEqual([[1, 2, 3], [4, 5]]);
  });

  it("emits the trailing buffer when the source completes", async () => {
    const subject: Writable<any> = atom<number>();
    const results: number[][] = [];
    const buffered = pipe(subject, bufferWhile(() => false));

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    subject.next(9);
    subject.dispose();
    await waitTick();
    await completed;

    expect(results).toEqual([[9]]);
  });

  it("supports index parameter in predicate", async () => {
    const subject: Writable<any> = atom<number>();
    const results: number[][] = [];
    const indices: number[] = [];
    const buffered = pipe(
      subject,
      bufferWhile((_value, index, buffer) => {
        indices.push(index);
        return buffer.length < 3; // Flush when buffer size reaches 3
      })
    );

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    subject.next(10);
    subject.next(20);
    subject.next(30);
    await waitTick();

    subject.next(40);
    subject.dispose();
    await waitTick();
    await completed;

    expect(results).toEqual([[10, 20, 30], [40]]);
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it("uses index to flush based on value position", async () => {
    const subject: Writable<any> = atom<string>();
    const results: string[][] = [];
    const buffered = pipe(
      subject,
      bufferWhile((_value, index) => index < 2) // Flush after 2 values
    );

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    subject.next("a");
    subject.next("b");
    await waitTick();

    subject.next("c");
    subject.dispose();
    await waitTick();
    await completed;

    expect(results).toEqual([["a", "b"], ["c"]]);
  });

  it("supports async predicates", async () => {
    const subject: Writable<any> = atom<number>();
    const results: number[][] = [];
    const buffered = pipe(
      subject,
      bufferWhile((_value, _index, buffer) => Promise.resolve(buffer.length < 2))
    );

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    await waitTick();

    subject.next(3);
    subject.dispose();
    await waitTick();
    await completed;

    expect(results).toEqual([[1, 2], [3]]);
  });

  it("does not emit when source completes without values", async () => {
    const subject: Writable<any> = atom<number>();
    const results: number[][] = [];
    const buffered = pipe(subject, bufferWhile(() => true));

    const completed = (async () => {
      for await (const value of iterate(buffered)) {
        results.push(value);
      }
    })();

    subject.dispose();
    await waitTick();
    await completed;

    expect(results).toEqual([]);
  });
});
