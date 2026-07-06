import { atom, from, iterate, pipe, takeUntil, timer } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('takeUntil', () => {
  it('takes source values until the notifier emits', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(pipe(source, takeUntil(notifier)))) {
        values.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    notifier.next();
    source.next(3);

    await reader;
    expect(values).toEqual([1, 2]);
  });

  it('emits all values when the source completes first', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(from([1, 2, 3]), takeUntil(timer(100))))) {
      values.push(value);
    }

    expect(values).toEqual([1, 2, 3]);
  });

  it('emits no source values when the notifier emits first', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(pipe(source, takeUntil(notifier)))) {
        values.push(value);
      }
    })();

    notifier.next();
    source.next(1);

    await reader;
    expect(values).toEqual([]);
  });

  it('propagates notifier errors after already emitted source values', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(pipe(source, takeUntil(notifier)))) {
        values.push(value);
      }
    })();

    source.next(1);
    await wait(0);
    notifier.fail(new Error('Notifier failure'));

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'Notifier failure' }));
    expect(values).toEqual([1]);
  });
});
