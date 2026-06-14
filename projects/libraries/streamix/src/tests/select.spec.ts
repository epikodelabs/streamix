import { atom, iterate, pipe, select } from '@epikodelabs/streamix';

describe('select', () => {
  let subject: ReturnType<typeof atom>;
  let source: ReturnType<typeof atom>;

  beforeEach(() => {
    subject = atom();
    source = subject;
  });

  it("should emit selected values based on indexIterator", async () => {
    const indexes = [0, 2, 4];
    const selectStream = pipe(source, select(indexes[Symbol.iterator]()));
    const results: any[] = [];

    const done = (async () => {
      for await (const value of iterate(selectStream)) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.next(4);
    subject.next(5);
    subject.dispose();

    await done;

    expect(results).toEqual([1, 3, 5]); // Only values at indexes 0, 2, 4 should be emitted
  });

  it("should complete immediately if indexIterator is empty", async () => {
    const indexes: number[] = []; // Empty iterator, no indexes to select
    const selectStream = pipe(source, select(indexes[Symbol.iterator]()));
    const results: any[] = [];

    const done = (async () => {
      for await (const value of iterate(selectStream)) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.dispose();
    await done;

    expect(results).toEqual([]); // No values should be emitted
  });

  it("should not emit values if indexIterator has indexes beyond the stream length", async () => {
    const indexes = [10, 11, 12]; // Indexes beyond the length of the stream
    const selectStream = pipe(source, select(indexes[Symbol.iterator]()));
    const results: any[] = [];

    const done = (async () => {
      for await (const value of iterate(selectStream)) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.dispose();
    await done;

    expect(results).toEqual([]); // No values should be emitted
  });

  it("should emit only the valid values when indexIterator has mixed valid and invalid indexes", async () => {
    const indexes = [0, 2, 10]; // 10 is beyond the stream length
    const selectStream = pipe(source, select(indexes[Symbol.iterator]()));
    const results: any[] = [];

    const done = (async () => {
      for await (const value of iterate(selectStream)) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.dispose();
    await done;

    expect(results).toEqual([1, 3]); // Only values at indexes 0 and 2 should be emitted
  });
});
