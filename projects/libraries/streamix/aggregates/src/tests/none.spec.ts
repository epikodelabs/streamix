import { createSubject, type Stream } from '@epikodelabs/streamix';
import { none } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('none', () => {
  let subject: ReturnType<typeof createSubject<number>>;
  let source: Stream<number>;

  beforeEach(() => {
    subject = createSubject<number>();
    source = subject;
  });

  it('should emit true when no values satisfy the predicate', async () => {
    const predicate = (value: number) => value > 10;
    const noneStream = source.pipe(none(predicate));
    const results: boolean[] = [];

    (async () => {
      for await (const value of noneStream) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(9);
    subject.complete();
    await settle();

    expect(results).toEqual([true]);
  });

  it('should emit false immediately once a value satisfies the predicate', async () => {
    const predicate = (value: number) => value > 5;
    const noneStream = source.pipe(none(predicate));
    const results: boolean[] = [];

    (async () => {
      for await (const value of noneStream) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(6);
    subject.next(2);
    subject.complete();
    await settle();

    expect(results).toEqual([false]);
  });

  it('should await asynchronous predicates before deciding', async () => {
    const predicate = async (value: number) => value === 3;
    const noneStream = source.pipe(none(predicate));
    const results: boolean[] = [];

    (async () => {
      for await (const value of noneStream) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.complete();
    await settle();

    expect(results).toEqual([false]);
  });
});
