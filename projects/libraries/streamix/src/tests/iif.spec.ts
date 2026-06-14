import { from, iif } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('iif', () => {
  it('should choose trueStream when condition is true', async () => {
    const trueStream = from([10, 20, 30]);
    const falseStream = from([1, 2, 3]);

    const atom = iif(() => true, trueStream, falseStream);
    const result: number[] = [];

    atom.subscribe(v => { if (v !== undefined) result.push(v); });
    await delay();

    expect(result).toEqual([10, 20, 30]);
  });

  it('should choose falseStream when condition is false', async () => {
    const trueStream = from([10, 20, 30]);
    const falseStream = from([1, 2, 3]);

    const atom = iif(() => false, trueStream, falseStream);
    const result: number[] = [];

    atom.subscribe(v => { if (v !== undefined) result.push(v); });
    await delay();

    expect(result).toEqual([1, 2, 3]);
  });

  it('should resolve asynchronous conditions and promise-based streams', async () => {
    const trueStream = from(['true-case']);
    const falseStream = Promise.resolve('false-case');

    const atom = iif(() => Promise.resolve(false), trueStream, falseStream);
    const result: string[] = [];

    atom.subscribe(v => { if (v !== undefined) result.push(v); });
    await delay();

    expect(result).toEqual(['false-case']);
  });
});
