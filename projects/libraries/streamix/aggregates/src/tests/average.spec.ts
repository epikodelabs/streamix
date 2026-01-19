import { createSubject, type Stream } from '@epikodelabs/streamix';
import { average } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('average', () => {
  let subject: ReturnType<typeof createSubject<number>>;
  let source: Stream<number>;

  beforeEach(() => {
    subject = createSubject<number>();
    source = subject;
  });

  it('should emit the arithmetic mean of all values', async () => {
    const averageStream = source.pipe(average());
    const results: number[] = [];

    (async () => {
      for await (const value of averageStream) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(5);
    subject.next(4);
    subject.complete();
    await settle();

    expect(results).toEqual([10 / 3]);
  });

  it('should use the provided selector and await promises', async () => {
    const averageStream = source.pipe(
      average(async (value) => value.score * 2)
    );
    const results: number[] = [];

    (async () => {
      for await (const value of averageStream) {
        results.push(value);
      }
    })();

    subject.next({ score: 1 });
    subject.next({ score: 3 });
    subject.complete();
    await settle();

    expect(results).toEqual([4]);
  });

  it('should emit 0 when the source stream is empty', async () => {
    const averageStream = source.pipe(average());
    const results: number[] = [];

    (async () => {
      for await (const value of averageStream) {
        results.push(value);
      }
    })();

    subject.complete();
    await settle();

    expect(results).toEqual([0]);
  });
});
