import { atom, audit, iterate, pipe, type Writable } from '@epikodelabs/streamix';

describe('audit', () => {
  let input: Writable;

  beforeEach(() => { 
    input = atom<number>();
  });

  it('should emit the latest value after a period of inactivity and on completion', async () => {
    const auditedAtom = pipe(input, audit(100));
    const receivedValues: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(auditedAtom)) {
        receivedValues.push(value);
      }
    })();

    input.next(1);
    setTimeout(() => input.next(2), 50);
    setTimeout(() => input.next(3), 150);
    setTimeout(() => input.next(4), 200);
    setTimeout(() => input.next(5), 300);
    setTimeout(() => input.dispose(), 400);

    await reader;
    expect(receivedValues).toEqual([2, 4, 5]);
  });

  it('should complete the stream immediately after input completes with no buffered value', async () => {
    const auditedAtom = pipe(input, audit(100));
    const receivedValues: number[] = [];
    let completed = false;

    const reader = (async () => {
      for await (const value of iterate(auditedAtom)) {
        receivedValues.push(value);
      }
      completed = true;
    })();

    input.dispose();

    await reader;
    expect(completed).toBeTrue();
    expect(receivedValues).toEqual([]);
  });

  it('should emit the last value when input completes during the audit duration', async () => {
    const auditedAtom = pipe(input, audit(100));
    const receivedValues: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(auditedAtom)) {
        receivedValues.push(value);
      }
    })();

    input.next(1);
    setTimeout(() => input.next(2), 50);
    setTimeout(() => input.next(3), 150);
    setTimeout(() => input.dispose(), 175);

    await reader;
    expect(receivedValues).toEqual([2, 3]);
  });

  it('should emit the single value when input completes before audit duration', async () => {
    const auditedAtom = pipe(input, audit(100));
    const receivedValues: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(auditedAtom)) {
        receivedValues.push(value);
      }
    })();

    input.next(1);
    setTimeout(() => input.dispose(), 50);

    await reader;
    expect(receivedValues).toEqual([1]);
  });

  it('should propagate errors from the input stream', async () => {
    const auditedAtom = pipe(input, audit(100));
    let caught: any;

    const reader = (async () => {
      try {
        for await (const _ of iterate(auditedAtom)) {
          void _;
        }
      } catch (err) {
        caught = err;
      }
    })();

    input.fail(new Error('Test Error'));

    await reader;
    expect(caught).toEqual(new Error('Test Error'));
  });
});
