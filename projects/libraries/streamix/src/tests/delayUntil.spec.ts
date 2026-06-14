import { atom, delayUntil, iterate, pipe } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('delayUntil', () => {
  it('should delay emissions until the condition stream emits a value', async () => {
    const sourceStream = atom<number>();
    const conditionStream = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(sourceStream, delayUntil(conditionStream)))) {
        emittedValues.push(value);
      }
    })();

    sourceStream.next(1);
    conditionStream.next('start');
    sourceStream.next(2);
    sourceStream.next(3);
    sourceStream.next(4);
    sourceStream.dispose();
    conditionStream.dispose();

    await reader;
    expect(emittedValues).toEqual([1, 2, 3, 4]);
  });

  it('should not emit any values if condition stream does not emit', async () => {
    const sourceStream = atom<number>();
    const conditionStream = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(sourceStream, delayUntil(conditionStream)))) {
        emittedValues.push(value);
      }
    })();

    sourceStream.next(1);
    sourceStream.next(2);
    sourceStream.next(3);
    sourceStream.dispose();
    conditionStream.dispose();

    await reader;
    expect(emittedValues).toEqual([]);
  });

  it('should drop values after notifier completes without emitting', async () => {
    const sourceStream = atom<number>();
    const conditionStream = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(sourceStream, delayUntil(conditionStream)))) {
        emittedValues.push(value);
      }
    })();

    conditionStream.dispose();
    sourceStream.next(1);
    sourceStream.next(2);
    sourceStream.dispose();

    await reader;
    expect(emittedValues).toEqual([]);
  });

  it('should emit the source stream values after condition stream emits', async () => {
    const sourceStream = atom<number>();
    const conditionStream = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(sourceStream, delayUntil(conditionStream)))) {
        emittedValues.push(value);
      }
    })();

    conditionStream.next('start');
    sourceStream.next(10);
    sourceStream.next(20);
    sourceStream.next(30);
    sourceStream.dispose();
    conditionStream.dispose();

    await reader;
    expect(emittedValues).toEqual([10, 20, 30]);
  });

  it('should handle error in source stream', async () => {
    const sourceStream = atom<number>();
    const conditionStream = atom<any>();

    const reader = (async () => {
      for await (const _ of iterate(pipe(sourceStream, delayUntil(conditionStream)))) {
        void _;
      }
    })();

    sourceStream.next(1);
    sourceStream.error(new Error('Something went wrong'));
    conditionStream.next('start');

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'Something went wrong' }));
  });

  it('should propagate notifier errors', async () => {
    const sourceStream = atom<number>();
    const conditionStream = atom<any>();

    const reader = (async () => {
      for await (const _ of iterate(pipe(sourceStream, delayUntil(conditionStream)))) {
        void _;
      }
    })();

    sourceStream.next(7);
    conditionStream.error(new Error('Notifier failed'));

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'Notifier failed' }));
  });

  it('should flush buffer when notifier promise resolves', async () => {
    const sourceStream = atom<number>();
    const notifierPromise = new Promise<void>((resolve) => setTimeout(resolve, 20));

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(sourceStream, delayUntil(notifierPromise)))) {
        emittedValues.push(value);
      }
    })();

    sourceStream.next(8);
    sourceStream.next(9);

    await wait(40);
    sourceStream.dispose();

    await reader;
    expect(emittedValues).toEqual([8, 9]);
  });

  it('should complete the stream after both source and condition streams complete', async () => {
    const sourceStream = atom<number>();
    const conditionStream = atom<any>();

    const emittedValues: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(sourceStream, delayUntil(conditionStream)))) {
        emittedValues.push(value);
      }
    })();

    conditionStream.next('start');
    sourceStream.next(5);
    sourceStream.next(6);
    sourceStream.next(7);
    sourceStream.dispose();
    conditionStream.dispose();

    await reader;
    expect(emittedValues).toEqual([5, 6, 7]);
  });
});
