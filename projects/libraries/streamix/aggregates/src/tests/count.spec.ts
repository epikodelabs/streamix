import { atom } from '@epikodelabs/streamix';
import { count } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('count', () => {
  let subject: ReturnType<typeof atom>;
  let source: ReturnType<typeof atom>;

  beforeEach(() => {
    subject = atom<number>();
    source = subject;
  });

  it('should emit the count of values', async () => {
    const countResult = source.pipe(count());
    const results: number[] = [];

    void (async () => {
      for await (const value of countResult) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.dispose();
    await settle();

    expect(results).toEqual([3]);
  });

  it('should emit 0 for an empty stream', async () => {
    const countResult = source.pipe(count());
    const results: number[] = [];

    void (async () => {
      for await (const value of countResult) {
        results.push(value);
      }
    })();

    subject.dispose();
    await settle();

    expect(results).toEqual([0]);
  });

  it('should propagate errors from the source stream', async () => {
    const countResult = source.pipe(count());
    let error: any = null;

    void (async () => {
      try {
        for await (const _ of countResult) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    subject.fail(new Error('Test Error'));
    await settle();

    expect(error).toEqual(new Error('Test Error'));
  });
});
