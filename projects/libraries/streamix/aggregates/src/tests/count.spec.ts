import { createSubject, type Stream } from '@epikodelabs/streamix';
import { count } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('count', () => {
  let subject: ReturnType<typeof createSubject<number>>;
  let source: Stream<number>;

  beforeEach(() => {
    subject = createSubject<number>();
    source = subject;
  });

  it('should emit the count of values', async () => {
    const countStream = source.pipe(count());
    const results: number[] = [];

    (async () => {
      for await (const value of countStream) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.complete();
    await settle();

    expect(results).toEqual([3]);
  });

  it('should emit 0 for an empty stream', async () => {
    const countStream = source.pipe(count());
    const results: number[] = [];

    (async () => {
      for await (const value of countStream) {
        results.push(value);
      }
    })();

    subject.complete();
    await settle();

    expect(results).toEqual([0]);
  });

  it('should propagate errors from the source stream', async () => {
    const countStream = source.pipe(count());
    let error: any = null;

    (async () => {
      try {
        for await (const _ of countStream) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    subject.error(new Error('Test Error'));
    await settle();

    expect(error).toEqual(new Error('Test Error'));
  });
});
