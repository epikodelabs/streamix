import { ignoreElements, iterate, atom as makeAtom, pipe, type Writable } from '@epikodelabs/streamix';

describe('ignoreElements', () => {
  it('should ignore all emitted values and only emit complete', async () => {
    const subject: Writable<any> = makeAtom<any>();
    const atom = pipe(subject, ignoreElements());

    const results: number[] = [];
    const consumption$ = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.dispose();

    await consumption$;

    expect(results).toEqual([]);
  });

  it('should pass error notifications through', async () => {
    const subject: Writable<any> = makeAtom<any>();
    const atom = pipe(subject, ignoreElements());

    let error: any = null;
    const consumption$ = (async () => {
      try {
        for await (const _ of iterate(atom)) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.fail(new Error('Test error'));

    await consumption$;

    expect(error).toEqual(jasmine.any(Error));
    expect(error.message).toBe('Test error');
  });

  it('should complete after source stream completes', async () => {
    const subject: Writable<any> = makeAtom<any>();
    const atom = pipe(subject, ignoreElements());

    const results: number[] = [];
    const consumption$ = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.next(10);
    subject.next(20);
    subject.dispose();

    await consumption$;

    expect(results).toEqual([]);
  });

  it('should not emit any value but should handle complete', async () => {
    const subject: Writable<any> = makeAtom<any>();
    const atom = pipe(subject, ignoreElements());

    const results: string[] = [];
    const consumption$ = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.next('value1');
    subject.next('value2');
    subject.dispose();

    await consumption$;

    expect(results).toEqual([]);
  });

  it('should handle error in source stream', async () => {
    const subject: Writable<any> = makeAtom<any>();
    const atom = pipe(subject, ignoreElements());

    let error: any = null;
    const consumption$ = (async () => {
      try {
        for await (const _ of iterate(atom)) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    subject.next('value1');
    subject.next('value2');
    subject.fail(new Error('Some error'));

    await consumption$;

    expect(error).toEqual(jasmine.any(Error));
    expect(error.message).toBe('Some error');
  });
});
