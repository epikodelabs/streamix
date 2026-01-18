import { createSubject, delay, exhaustMap, from } from '@epikodelabs/streamix';

describe('exhaustMap', () => {
  it('does not start a second inner stream while the first is active', (done) => {
    const subject = createSubject<number>();
    const results: number[] = [];
    let projectCalls = 0;

    const stream = subject.pipe(
      exhaustMap((value) => {
        projectCalls++;
        return from([value]).pipe(delay(20));
      })
    );

    stream.subscribe({
      next(value) {
        results.push(value);
      },
      complete() {
        expect(results).toEqual([1]);
        expect(projectCalls).toBe(1);
        done();
      },
    });

    subject.next(1);

    setTimeout(() => {
      subject.next(2);
      subject.next(3);
    }, 5);

    setTimeout(() => {
      subject.complete();
    }, 150);
  });

  it('restarts after the inner stream completes', (done) => {
    const subject = createSubject<number>();
    const results: number[] = [];
    let projectCalls = 0;

    const stream = subject.pipe(
      exhaustMap((value) => {
        projectCalls++;
        return from([value]).pipe(delay(50)); // Increased delay
      })
    );

    stream.subscribe({
      next(value) {
        results.push(value);
      },
      complete() {
        expect(results).toEqual([1, 4]);
        expect(projectCalls).toBe(2);
        done();
      },
    });

    subject.next(1); // t=0, inner completes at t=50
    setTimeout(() => {
      subject.next(2); // t=10, ignored (inner still active)
      subject.next(3); // t=10, ignored (inner still active)
    }, 10);
    setTimeout(() => {
      subject.next(4); // t=70, accepted (inner completed at t=50)
    }, 70); // After first inner completes
    setTimeout(() => {
      subject.complete(); // t=130, after second inner completes (70+50=120)
    }, 130);
  });

  it('propagates inner errors and ignores later sources', (done) => {
    const subject = createSubject<number>();
    const results: number[] = [];

    const stream = subject.pipe(
      exhaustMap((value) => {
        if (value === 1) {
          return from([value]).pipe(delay(10));
        }
        if (value === 2) {
          // This will only be reached if value 1's inner stream is DONE
          throw new Error('boom');
        }
        return from([value]);
      })
    );

    stream.subscribe({
      next(v) { results.push(v); },
      error(err) {
        expect(err.message).toBe('boom');
        expect(results).toEqual([1]);
        done();
      },
    });

    subject.next(1); // t=0, finishes at t=10

    setTimeout(() => {
      // t=5: This is STILL ignored by standard exhaustMap
      subject.next(3); 
    }, 5);

    setTimeout(() => {
      // t=15: Value 1 is done. Now 2 will be accepted and throw!
      subject.next(2); 
    }, 15);
  });
});
