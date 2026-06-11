import { atom, fromAtom, select, type Atom } from '@epikodelabs/streamix';

describe('select', () => {
  let source$: Atom<any>;
  let source: any;

  beforeEach(() => {
    source$ = atom();
    source = fromAtom(source$);
  });

  it("should emit selected values based on indexIterator", async () => {
    const indexes = [0, 2, 4];
    const selectStream = source.pipe(select(indexes[Symbol.iterator]()));
    const results: any[] = [];

    // Create a promise that resolves when consumption is complete
    void (async () => {
      for await (const value of selectStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.set(4);
    source$.set(5);
    source$.dispose();

    // Wait for the consumption to finish
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([1, 3, 5]); // Only values at indexes 0, 2, 4 should be emitted
  });

  it("should complete immediately if indexIterator is empty", async () => {
    const indexes: number[] = []; // Empty iterator, no indexes to select
    const selectStream = source.pipe(select(indexes[Symbol.iterator]()));
    const results: any[] = [];

    void (async () => {
      for await (const value of selectStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([]); // No values should be emitted
  });

  it("should not emit values if indexIterator has indexes beyond the stream length", async () => {
    const indexes = [10, 11, 12]; // Indexes beyond the length of the stream
    const selectStream = source.pipe(select(indexes[Symbol.iterator]()));
    const results: any[] = [];

    void (async () => {
      for await (const value of selectStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([]); // No values should be emitted
  });

  it("should emit only the valid values when indexIterator has mixed valid and invalid indexes", async () => {
    const indexes = [0, 2, 10]; // 10 is beyond the stream length
    const selectStream = source.pipe(select(indexes[Symbol.iterator]()));
    const results: any[] = [];

    void (async () => {
      for await (const value of selectStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([1, 3]); // Only values at indexes 0 and 2 should be emitted
  });
});


