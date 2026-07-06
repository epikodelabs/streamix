import { atom, from, iterate, pipe, skipUntil } from '@epikodelabs/streamix';

const waitTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('skipUntil', () => {
  it('skips source values before the notifier emits', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(pipe(source, skipUntil(notifier)))) {
        values.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    notifier.next();
    await waitTick();
    source.next(3);
    source.next(4);
    source.dispose();
    notifier.dispose();

    await reader;
    expect(values).toEqual([3, 4]);
  });

  it('drops source backlog when an immediate notifier opens the gate', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(from([1, 2, 3]), skipUntil(from([true]))))) {
      values.push(value);
    }

    expect(values).toEqual([2, 3]);
  });

  it('keeps skipping when the notifier completes without emitting', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(pipe(source, skipUntil(notifier)))) {
        values.push(value);
      }
    })();

    notifier.dispose();
    source.next(1);
    source.next(2);
    source.dispose();

    await reader;
    expect(values).toEqual([]);
  });

  it('propagates notifier errors', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const reader = (async () => {
      for await (const _ of iterate(pipe(source, skipUntil(notifier)))) {
        void _;
      }
    })();

    notifier.fail(new Error('Notifier failed'));

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'Notifier failed' }));
  });
});
