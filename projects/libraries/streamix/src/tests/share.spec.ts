import { atom, flow, iterate, pipe, share } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('share', () => {
  it('shares one source execution across overlapping consumers', async () => {
    let executions = 0;
    const source = flow<number>(async function* () {
      executions++;
      yield 1;
      await wait(10);
      yield 2;
      await wait(10);
      yield 3;
    });
    const shared = pipe(source, share());

    const first: number[] = [];
    const second: number[] = [];
    const firstRun = (async () => {
      for await (const value of iterate(shared)) first.push(value);
    })();

    await wait(5);

    const secondRun = (async () => {
      for await (const value of iterate(shared)) second.push(value);
    })();

    await Promise.all([firstRun, secondRun]);

    expect(executions).toBe(1);
    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([2, 3]);
  });

  it('does not replay values emitted before a later consumer subscribes', async () => {
    const source = atom<number>();
    const shared = pipe(source, share());

    const first: number[] = [];
    const second: number[] = [];
    const firstRun = (async () => {
      for await (const value of iterate(shared)) first.push(value);
    })();

    source.next(1);
    await wait(0);

    const secondRun = (async () => {
      for await (const value of iterate(shared)) second.push(value);
    })();

    source.next(2);
    source.next(3);
    source.dispose();

    await Promise.all([firstRun, secondRun]);

    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([2, 3]);
  });

  it('propagates source errors to consumers', async () => {
    const source = atom<number>();
    const shared = pipe(source, share());
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(shared)) values.push(value);
    })();

    source.next(1);
    source.fail(new Error('boom'));

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'boom' }));
    expect(values).toEqual([1]);
  });

  it('handles iterator return', async () => {
    const source = atom<number>();
    const shared = pipe(source, share());
    const iterator = iterate(shared)[Symbol.asyncIterator]();

    source.next(1);
    expect(await iterator.next()).toEqual({ value: 1, done: false });

    expect(await iterator.return?.()).toEqual({ value: undefined, done: true });
  });
});
