import { createSubject, type Stream } from '@epikodelabs/streamix';
import { mode } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('mode', () => {
  let subject: ReturnType<typeof createSubject<number>>;
  let source: Stream<number>;

  beforeEach(() => {
    subject = createSubject<number>();
    source = subject;
  });

  it('should emit the most frequently occurring value', async () => {
    const modeStream = source.pipe(mode());
    const results: number[][] = [];

    (async () => {
      for await (const value of modeStream) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(2);
    subject.next(3);
    subject.complete();
    await settle();

    expect(results).toEqual([[2]]);
  });

  it('should emit all values that share the top frequency', async () => {
    const modeStream = source.pipe(mode());
    const results: number[][] = [];

    (async () => {
      for await (const value of modeStream) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(1);
    subject.next(2);
    subject.complete();
    await settle();

    expect(results).toEqual([[1, 2]]);
  });

  it('should be able to key values before counting', async () => {
    const itemSubject = createSubject<{ group: string; value: string }>();
    const itemSource: Stream<{ group: string; value: string }> = itemSubject;
    const modeStream = itemSource.pipe(mode((item) => item.group));
    const results: { group: string; value: string }[][] = [];

    (async () => {
      for await (const value of modeStream) {
        results.push(value);
      }
    })();

    itemSubject.next({ group: 'alpha', value: 'a' });
    itemSubject.next({ group: 'beta', value: 'b' });
    itemSubject.next({ group: 'alpha', value: 'a2' });
    itemSubject.next({ group: 'beta', value: 'b2' });
    itemSubject.complete();
    await settle();

    expect(results).toEqual([
      [
        { group: 'alpha', value: 'a' },
        { group: 'beta', value: 'b' },
      ],
    ]);
  });

  it('should not emit when the stream is empty', async () => {
    const modeStream = source.pipe(mode());
    const results: number[][] = [];

    (async () => {
      for await (const value of modeStream) {
        results.push(value);
      }
    })();

    subject.complete();
    await settle();

    expect(results).toEqual([]);
  });
});
