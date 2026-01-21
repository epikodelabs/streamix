import { createSubject, type Stream } from '@epikodelabs/streamix';
import { min } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('min', () => {
  let subject: ReturnType<typeof createSubject<number>>;
  let source: Stream<number>;

  beforeEach(() => {
    subject = createSubject<number>();
    source = subject;
  });

  it('should emit the smallest value', async () => {
    const minStream = source.pipe(min());
    const results: number[] = [];

    (async () => {
      for await (const value of minStream) {
        results.push(value);
      }
    })();

    subject.next(3);
    subject.next(1); // Smallest value
    subject.next(2);
    subject.complete();
    await settle();

    expect(results).toEqual([1]);
  });

  it('should propagate errors from the source stream', async () => {
    const minStream = source.pipe(min());
    let error: any = null;

    (async () => {
      try {
        for await (const _ of minStream) {
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
