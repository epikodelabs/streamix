import { createSubject, type Stream } from '@epikodelabs/streamix';
import { max } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('max', () => {
  let subject: ReturnType<typeof createSubject<number>>;
  let source: Stream<number>;

  beforeEach(() => {
    subject = createSubject<number>();
    source = subject;
  });

  it('should emit the largest value', async () => {
    const maxStream = source.pipe(max());
    const results: number[] = [];

    (async () => {
      for await (const value of maxStream) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(3); // Largest value
    subject.next(2);
    subject.complete();
    await settle();

    expect(results).toEqual([3]);
  });

  it('should propagate errors from the source stream', async () => {
    const maxStream = source.pipe(max());
    let error: any = null;

    (async () => {
      try {
        for await (const _ of maxStream) {
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
