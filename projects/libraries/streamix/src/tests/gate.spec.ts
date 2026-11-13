import { atom, createAsyncPushable, from, gate, pipe } from '@epikodelabs/streamix';
import { collect, sleep } from './helpers/operator';

describe('gate', () => {
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
