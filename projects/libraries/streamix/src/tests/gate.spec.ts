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
  });
});
