import {range} from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe("range", () => {
  it("should emit the correct range of values", async () => {
    const start = 1;
    const count = 5;
    const expectedValues = [1, 2, 3, 4, 5];
    const emittedValues: number[] = [];

    const atom = range(start, count);
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues).toEqual(expectedValues);
  });

  it("should stop emitting after the specified count", async () => {
    const start = 0;
    const count = 3;
    const emittedValues: number[] = [];

    const atom = range(start, count);
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues.length).toBe(count);
  });

  it("should handle a zero count by completing without emitting values", async () => {
    const start = 10;
    const count = 0;
    const emittedValues: number[] = [];

    const atom = range(start, count);
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues.length).toBe(0);
  });

  it("should emit values in order starting from the start value", async () => {
    const start = 10;
    const count = 4;
    const expectedValues = [10, 11, 12, 13];
    const emittedValues: number[] = [];

    const atom = range(start, count);
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues).toEqual(expectedValues);
  });

  it("should complete immediately if count is 0", async () => {
    const start = 5;
    const count = 0;
    const emittedValues: number[] = [];

    const atom = range(start, count);
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues.length).toBe(0);
  });

  it("applies start, count, and step parameters directly", async () => {
    const emitted: number[] = [];

    range(2, 3, 5).subscribe(v => { if (v !== undefined) emitted.push(v); });
    await delay();

    expect(emitted).toEqual([2, 7, 12]);
  });

  it("supports negative step values", async () => {
    const emitted: number[] = [];

    range(5, 3, -1).subscribe(v => { if (v !== undefined) emitted.push(v); });
    await delay();

    expect(emitted).toEqual([5, 4, 3]);
  });
});
