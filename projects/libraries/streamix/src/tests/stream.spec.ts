import { createSubject, from, map } from '@epikodelabs/streamix';

describe('stream', () => {
  it('allows base streams to be consumed with for-await', async () => {
    const values: number[] = [];

    for await (const value of from([1, 2, 3])) {
      values.push(value);
    }

    expect(values).toEqual([1, 2, 3]);
  });

  it('keeps piped streams iterable', async () => {
    const doubled = from([1, 2]).pipe(map(v => v * 2));
    const values: number[] = [];

    for await (const value of doubled) {
      values.push(value);
    }

    expect(values).toEqual([2, 4]);
  });

  it('supports async iteration over subjects', async () => {
    const subject = createSubject<number>();
    const received: number[] = [];

    const iterate = (async () => {
      for await (const value of subject) {
        received.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.complete();

    await iterate;
    expect(received).toEqual([1, 2]);
  });
});



