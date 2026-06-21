import { atom, delayUntil, iterate, pipe } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('delayUntil', () => {
  it('should delay emissions until the condition stream emits a value', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    source.next(1);
    condition.next('start');
    source.next(2);
    source.next(3);
    source.next(4);
    source.dispose();
    condition.dispose();

    await reader;
    expect(emittedValues).toEqual([1, 2, 3, 4]);
  });

  it('should not emit any values if condition stream does not emit', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    source.next(3);
    source.dispose();
    condition.dispose();

    await reader;
    expect(emittedValues).toEqual([]);
  });

  it('should drop values after notifier completes without emitting', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    condition.dispose();
    source.next(1);
    source.next(2);
    source.dispose();

    await reader;
    expect(emittedValues).toEqual([]);
  });

  it('should emit the source stream values after condition stream emits', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    condition.next('start');
    source.next(10);
    source.next(20);
    source.next(30);
    source.dispose();
    condition.dispose();

    await reader;
    expect(emittedValues).toEqual([10, 20, 30]);
  });

  it('should handle error in source stream', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const reader = (async () => {
      for await (const _ of iterate(pipe(source, delayUntil(condition)))) {
        void _;
      }
    })();

    source.next(1);
    source.fail(new Error('Something went wrong'));
    condition.next('start');

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'Something went wrong' }));
  });

  it('should propagate notifier errors', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const reader = (async () => {
      for await (const _ of iterate(pipe(source, delayUntil(condition)))) {
        void _;
      }
    })();

    source.next(7);
    condition.fail(new Error('Notifier failed'));

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'Notifier failed' }));
  });

  it('should flush buffer when notifier promise resolves', async () => {
    const source = atom<number>();
    const notifierPromise = new Promise<void>((resolve) => setTimeout(resolve, 20));

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(notifierPromise)))) {
        emittedValues.push(value);
      }
    })();

    source.next(8);
    source.next(9);

    await wait(40);
    source.dispose();

    await reader;
    expect(emittedValues).toEqual([8, 9]);
  });

  it('should complete the stream after both source and condition streams complete', async () => {
    const source = atom<number>();
    const condition = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, delayUntil(condition)))) {
        emittedValues.push(value);
      }
    })();

    condition.next('start');
    source.next(5);
    source.next(6);
    source.next(7);
    source.dispose();
    condition.dispose();

    await reader;
    expect(emittedValues).toEqual([5, 6, 7]);
  });
});
