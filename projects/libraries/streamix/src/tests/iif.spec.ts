import { from, iif, switchMap } from '@epikodelabs/streamix';


describe('iif', () => {
  it('should choose trueStream when condition is true', (done) => {
    const condition = (value: number) => value > 5;
    const trueStream = from([10, 20, 30]);
    const falseStream = from([1, 2, 3]);

    const pipeline = from([6]).pipe(switchMap((value: any) => iif(() => condition(value), trueStream, falseStream)));
    const result: any[] = [];

    const subscription = pipeline.subscribe({
      next: (value: any) => result.push(value),
      complete: () => {
        expect(result).toEqual([10, 20, 30]);
        subscription.unsubscribe();
        done();
      }
    });
  });

  it('should choose falseStream when condition is false', (done) => {
    const condition = (value: number) => value > 5;
    const trueStream = from([10, 20, 30]);
    const falseStream = from([1, 2, 3]);

    const pipeline = from([2]).pipe(switchMap((value: any) => iif(() => condition(value), trueStream, falseStream)));
    const result: any[] = [];

    const subscription = pipeline.subscribe({
      next: (value: any) => result.push(value),
      complete: () => {
        expect(result).toEqual([1, 2, 3]);
        subscription.unsubscribe();
        done();
      }
    });
  });

  it('should resolve asynchronous conditions and promise-based streams', (done) => {
    const condition = () => Promise.resolve(false);
    const trueStream = from(['true-case']);
    const falseStream = Promise.resolve(from(['false-case']));

    const result: string[] = [];
    const subscription = iif(condition, trueStream, falseStream).subscribe({
      next: (value: string) => result.push(value),
      complete: () => {
        expect(result).toEqual(['false-case']);
        subscription.unsubscribe();
        done();
      },
      error: (error: any) => {
        subscription.unsubscribe();
        done.fail(error);
      },
    });
  });
});


