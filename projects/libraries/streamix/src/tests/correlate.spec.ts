import { correlate, createAsyncPushable, pipe } from '@epikodelabs/streamix';
import { collect, sleep } from './helpers/operator';

describe('correlate', () => {
  it('pairs a request and response by key', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number; body: string }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: request => request.id,
      responseKey: response => response.id,
    })));
    requests.push({ id: 1 });
    await sleep(5);
    responses.push({ id: 1, body: 'ok' });
    requests.dispose();
    responses.dispose();
    expect(await values).toEqual([{ request: { id: 1 }, response: { id: 1, body: 'ok' } }]);
  });

  it('retains a response that arrives before its request', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
    })));
    responses.push({ id: 1 });
    await sleep(5);
    requests.push({ id: 1 });
    requests.dispose();
    responses.dispose();
    expect(await values).toEqual([{ request: { id: 1 }, response: { id: 1 } }]);
  });

  it('matches interleaved requests and responses by key', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number; body: string }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
    })));
    requests.push({ id: 1 });
    requests.push({ id: 2 });
    await sleep(5);
    responses.push({ id: 2, body: 'second' });
    responses.push({ id: 1, body: 'first' });
    await sleep(5);
    requests.dispose();
    responses.dispose();
    expect(await values).toEqual([
      { request: { id: 2 }, response: { id: 2, body: 'second' } },
      { request: { id: 1 }, response: { id: 1, body: 'first' } },
    ]);
  });

  it('keeps the latest response that arrived before its request', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number; body: string }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
    })));
    responses.push({ id: 1, body: 'stale' });
    responses.push({ id: 1, body: 'fresh' });
    await sleep(5);
    requests.push({ id: 1 });
    await sleep(5);
    requests.dispose();
    responses.dispose();
    expect(await values).toEqual([
      { request: { id: 1 }, response: { id: 1, body: 'fresh' } },
    ]);
  });

  it('fails on a duplicate outstanding request key', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
    })));
    requests.push({ id: 1 });
    requests.push({ id: 1 });
    await expectAsync(values).toBeRejectedWithError('Duplicate outstanding correlation key');
    requests.dispose();
    responses.dispose();
  });

  it('fails a request that exceeds the timeout', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
      timeout: 5,
    })));
    requests.push({ id: 1 });
    await expectAsync(values).toBeRejectedWithError('Correlation timed out');
    requests.dispose();
    responses.dispose();
  });

  it('fails when the response stream ends with pending requests', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
    })));
    requests.push({ id: 1 });
    await sleep(5);
    responses.dispose();
    await expectAsync(values).toBeRejectedWithError('Response source completed with outstanding requests');
    requests.dispose();
  });

  it('completes after a pending request is answered once the request stream ends', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number; body: string }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
    })));
    requests.push({ id: 1 });
    await sleep(5);
    requests.dispose();
    await sleep(5);
    responses.push({ id: 1, body: 'ok' });
    responses.dispose();
    expect(await values).toEqual([
      { request: { id: 1 }, response: { id: 1, body: 'ok' } },
    ]);
  });

  it('completes when the request stream ends with only unmatched early responses', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
    })));
    responses.push({ id: 9 });
    await sleep(5);
    requests.dispose();
    await sleep(5);
    responses.dispose();
    expect(await values).toEqual([]);
  });

  it('validates options when the operator is created, before acquiring responses', () => {
    const options = { requestKey: (value: { id: number }) => value.id, responseKey: (value: { id: number }) => value.id };
    let acquired = 0;
    const responses: AsyncIterable<{ id: number }> = {
      [Symbol.asyncIterator]() {
        acquired += 1;
        return { next: async () => ({ done: true, value: undefined }) };
      },
    };

    expect(() => correlate(responses, { ...options, timeout: -1 })).toThrowError(RangeError);
    expect(() => correlate(responses, { ...options, timeout: Infinity })).toThrowError(RangeError);
    expect(() => correlate(responses, { ...options, timeout: NaN })).toThrowError(RangeError);
    expect(() => correlate(responses, { ...options, earlyLimit: -1 })).toThrowError(RangeError);
    expect(() => correlate(responses, { ...options, earlyLimit: 1.5 })).toThrowError(RangeError);
    expect(acquired).toBe(0);
  });

  it('bounds unmatched early responses with drop-oldest', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number; body: string }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
      earlyLimit: 2,
    })));
    responses.push({ id: 1, body: 'one' });
    responses.push({ id: 2, body: 'two' });
    responses.push({ id: 3, body: 'three' });
    await sleep(5);

    // Keys 2 and 3 are retained; key 1 was the oldest and was dropped.
    requests.push({ id: 2 });
    requests.push({ id: 3 });
    await sleep(5);
    requests.push({ id: 1 });
    await sleep(5);
    responses.push({ id: 1, body: 'late' });
    await sleep(5);
    requests.dispose();
    responses.dispose();

    expect(await values).toEqual([
      { request: { id: 2 }, response: { id: 2, body: 'two' } },
      { request: { id: 3 }, response: { id: 3, body: 'three' } },
      { request: { id: 1 }, response: { id: 1, body: 'late' } },
    ]);
  });

  it('fails when early responses exceed the limit with the error policy', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
      earlyLimit: 1,
      earlyOverflow: 'error',
    })));
    responses.push({ id: 1 });
    responses.push({ id: 2 });

    await expectAsync(values).toBeRejectedWithError(RangeError, /early response capacity exceeded/);
    requests.dispose();
    responses.dispose();
  });

  it('does not count an updated early key against the limit', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number; body: string }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: value => value.id,
      responseKey: value => value.id,
      earlyLimit: 1,
    })));
    responses.push({ id: 1, body: 'stale' });
    responses.push({ id: 1, body: 'fresh' });
    await sleep(5);
    requests.push({ id: 1 });
    await sleep(5);
    requests.dispose();
    responses.dispose();

    expect(await values).toEqual([
      { request: { id: 1 }, response: { id: 1, body: 'fresh' } },
    ]);
  });

  it('fails the output when a key extractor throws', async () => {
    const requests = createAsyncPushable<{ id: number }>();
    const responses = createAsyncPushable<{ id: number }>();
    const values = collect(pipe(requests, correlate(responses, {
      requestKey: () => { throw new Error('bad key'); },
      responseKey: value => value.id,
    })));
    requests.push({ id: 1 });
    await expectAsync(values).toBeRejectedWithError('bad key');
    requests.dispose();
    responses.dispose();
  });
});
