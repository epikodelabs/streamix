import { atom } from '@epikodelabs/streamix';
import { sum } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('sum', () => {
  let subject: ReturnType<typeof atom>;
  let source: ReturnType<typeof atom>;

  beforeEach(() => {
    subject = atom<number>();
    source = subject;
  });

  it('should emit the sum of emitted values', async () => {
    const sumStream = source.pipe(sum());
    const results: number[] = [];

    void (async () => {
      for await (const value of sumStream) {
        results.push(value);
      }
    })();

    subject.next(2);
    subject.next(3);
    subject.next(5);
    subject.dispose();
    await settle();

    expect(results).toEqual([10]);
  });

  it('should respect asynchronous selectors', async () => {
    const sumStream = source.pipe(
      sum(async (value, index) => value + index)
    );
    const results: number[] = [];

    void (async () => {
      for await (const value of sumStream) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.dispose();
    await settle();

    expect(results).toEqual([9]);
  });

  it('should emit 0 if no values were emitted', async () => {
    const sumStream = source.pipe(sum());
    const results: number[] = [];

    void (async () => {
      for await (const value of sumStream) {
        results.push(value);
      }
    })();

    subject.dispose();
    await settle();

    expect(results).toEqual([0]);
  });
});
