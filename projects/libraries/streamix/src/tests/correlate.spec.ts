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
});
