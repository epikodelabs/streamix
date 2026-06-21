import {from, iif} from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('iif', () => {
  it('should choose trueSource when condition is true', async () => {
    const trueSource = from([10, 20, 30]);
    const falseSource = from([1, 2, 3]);

    const atom = iif(() => true, trueSource, falseSource);
    const result: number[] = [];

    atom.subscribe(v => { if (v !== undefined) result.push(v); });
    await delay();

    expect(result).toEqual([10, 20, 30]);
  });

  it('should choose falseSource when condition is false', async () => {
    const trueSource = from([10, 20, 30]);
    const falseSource = from([1, 2, 3]);

    const atom = iif(() => false, trueSource, falseSource);
    const result: number[] = [];

    atom.subscribe(v => { if (v !== undefined) result.push(v); });
    await delay();

    expect(result).toEqual([1, 2, 3]);
  });

  it('should resolve asynchronous conditions and promise-based streams', async () => {
    const trueSource = from(['true-case']);
    const falseSource = Promise.resolve('false-case');

    const atom = iif(() => Promise.resolve(false), trueSource, falseSource);
    const result: string[] = [];

    atom.subscribe(v => { if (v !== undefined) result.push(v); });
    await delay();

    expect(result).toEqual(['false-case']);
  });
});
