import { atom, createAsyncPushable, from, gate, pipe } from '@epikodelabs/streamix';
import { collect, sleep } from './helpers/operator';

describe('gate', () => {
  it('fails the output and closes the source when the initial pull throws synchronously', async () => {
    const failure = new Error('initial pull failed');
    const close = jasmine.createSpy('return').and.resolveTo({ done: true, value: undefined });
    const output = gate<number>(from([true])).apply({
      next() { throw failure; },
      return: close,
    });

    await expectAsync(output.next()).toBeRejectedWith(failure);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('drops values while closed and resumes without reconnecting upstream', async () => {
    const control = atom(false);
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control)));
    source.push(1);
    await sleep(5);
    control.set(true);
    source.push(2);
    source.dispose();
    expect(await values).toEqual([2]);
  });

  it('keeps the latest closed value when configured', async () => {
    const control = atom(false);
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control, { closed: 'latest' })));
    source.push(1);
    source.push(2);
    await sleep(5);
    control.set(true);
    source.dispose();
    expect(await values).toEqual([2]);
  });

  it('rejects an invalid buffer capacity immediately', () => {
    expect(() => gate(from([true]), { closed: 'buffer', capacity: 0 })).toThrowError(RangeError);
    expect(() => gate(from([true]), { closed: 'buffer', capacity: 1.5 })).toThrowError(RangeError);
  });

  it('buffers values while closed and flushes them in order on open', async () => {
    const control = atom(false);
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control, { closed: 'buffer', capacity: 3 })));
    source.push(1);
    source.push(2);
    source.push(3);
    await sleep(5);
    control.set(true);
    source.dispose();
    expect(await values).toEqual([1, 2, 3]);
  });

  it('fails on overflow with the default buffer policy', async () => {
    const control = atom(false);
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control, { closed: 'buffer', capacity: 2 })));
    source.push(1);
    source.push(2);
    source.push(3);
    await expectAsync(values).toBeRejectedWithError('gate buffer capacity exceeded');
    source.dispose();
  });

  it('drops incoming values on overflow with drop-newest', async () => {
    const control = atom(false);
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control, {
      closed: 'buffer', capacity: 2, overflow: 'drop-newest',
    })));
    source.push(1);
    source.push(2);
    source.push(3);
    await sleep(5);
    control.set(true);
    source.dispose();
    expect(await values).toEqual([1, 2]);
  });

  it('drops the oldest buffered value on overflow with drop-oldest', async () => {
    const control = atom(false);
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control, {
      closed: 'buffer', capacity: 2, overflow: 'drop-oldest',
    })));
    source.push(1);
    source.push(2);
    source.push(3);
    await sleep(5);
    control.set(true);
    source.dispose();
    expect(await values).toEqual([2, 3]);
  });

  function controllable<T>() {
    const pending: Array<(result: IteratorResult<T>) => void> = [];
    const iterator: AsyncIterator<T> = {
      next: () => new Promise<IteratorResult<T>>(resolve => { pending.push(resolve); }),
      return: async () => ({ done: true, value: undefined }),
    };
    return {
      iterator,
      emit(value: T) {
        pending.shift()!({ done: false, value });
      },
    };
  }

  function controllableControl() {
    const control = controllable<boolean>();
    return {
      ...control,
      input: {
        type: 'atom',
        value: false,
        subscribe: () => () => {},
        [Symbol.asyncIterator]: () => control.iterator,
      } as unknown as Parameters<typeof gate>[0],
    };
  }

  /** Reads the next admitted output value, or 'none' if the gate dropped it. */
  function outputReader(output: AsyncIterator<number> & { return(): Promise<IteratorResult<number>> }) {
    let pending: Promise<IteratorResult<number>> | undefined;
    return async (): Promise<number | 'none' | 'done'> => {
      pending ??= output.next();
      const result = await Promise.race([
        pending.then(value => ({ kind: 'value' as const, value })),
        new Promise<{ kind: 'none' }>(resolve => {
          setTimeout(() => resolve({ kind: 'none' }), 5);
        }),
      ]);
      if (result.kind === 'none') return 'none';
      pending = undefined;
      return result.value.done ? 'done' : result.value.value;
    };
  }

  it('admits same-tick values and control changes in resolution order', async () => {
    const control = controllableControl();
    const source = controllable<number>();
    const output = gate(control.input).apply(source.iterator) as AsyncIterator<number> & {
      return(): Promise<IteratorResult<number>>;
    };
    const take = outputReader(output);

    control.emit(true);
    await sleep(0);

    // The value resolves before the close: it is admitted while still open.
    source.emit(1);
    control.emit(false);
    expect(await take()).toBe(1);

    // A close that resolves first drops the later value.
    control.emit(true);
    await sleep(0);
    control.emit(false);
    source.emit(2);
    expect(await take()).toBe('none');

    // An open that resolves first admits the later value.
    control.emit(true);
    source.emit(3);
    expect(await take()).toBe(3);

    // A value that resolves first while closed is dropped before the open.
    control.emit(false);
    await sleep(0);
    source.emit(4);
    control.emit(true);
    expect(await take()).toBe('none');

    await output.return();
  });

  it('retains a value resolved before a same-tick open under the latest policy', async () => {
    const control = controllableControl();
    const source = controllable<number>();
    const output = gate(control.input, { closed: 'latest' }).apply(source.iterator) as AsyncIterator<number> & {
      return(): Promise<IteratorResult<number>>;
    };
    const take = outputReader(output);

    // The gate starts closed. The value resolves first and is retained; the
    // open that resolves next flushes it.
    source.emit(1);
    control.emit(true);
    expect(await take()).toBe(1);

    await output.return();
  });

  it('flushes retained values before live values on reopen', async () => {
    const control = atom(false);
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control, { closed: 'latest' })));
    source.push(1);
    await sleep(5);
    control.set(true);
    await sleep(5);
    source.push(2);
    await sleep(5);
    control.set(false);
    await sleep(5);
    source.push(3);
    control.set(true);
    await sleep(5);
    source.dispose();
    expect(await values).toEqual([1, 2, 3]);
  });

  it('starts open when the control current value is true', async () => {
    const control = atom(true);
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control)));
    await sleep(5);
    source.push(1);
    await sleep(5);
    source.dispose();
    expect(await values).toEqual([1]);
  });

  it('discards buffered values when the source completes while closed', async () => {
    const control = atom(false);
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control, { closed: 'buffer', capacity: 2 })));
    source.push(1);
    await sleep(5);
    source.dispose();
    expect(await values).toEqual([]);
  });

  it('keeps the last gate state when the control completes', async () => {
    const control = createAsyncPushable<boolean>();
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control)));
    control.push(true);
    await sleep(5);
    control.dispose();
    await sleep(5);
    source.push(1);
    await sleep(5);
    source.dispose();
    expect(await values).toEqual([1]);
  });

  it('fails the output when the source fails', async () => {
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(atom(true))));
    source.fail(new Error('source boom'));
    await expectAsync(values).toBeRejectedWithError('source boom');
    source.dispose();
  });

  it('fails the output when the control fails', async () => {
    const control = createAsyncPushable<boolean>();
    const source = createAsyncPushable<number>();
    const values = collect(pipe(source, gate(control)));
    control.fail(new Error('control boom'));
    await expectAsync(values).toBeRejectedWithError('control boom');
    source.dispose();
  });
});
