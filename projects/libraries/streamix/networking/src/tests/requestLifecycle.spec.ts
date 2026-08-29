import {
  createHttpClient,
  readJson,
  useRetry,
  type Middleware,
} from '@epikodelabs/streamix/networking';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of source) {
    out.push(value);
  }
  return out;
}

/** Middleware that overrides the transport with an injected fetch fn. */
const withFetch = (fetchFn: typeof fetch): Middleware =>
  (next) => (context) => next({ ...context, fetch: fetchFn });

describe('request lifecycle', () => {
  it('performs a fresh fetch for each iteration instead of sharing one response', async () => {
    let fetchCount = 0;
    const fetchFn = (async () => {
      fetchCount++;
      return jsonResponse({ attempt: fetchCount });
    }) as unknown as typeof fetch;

    const client = createHttpClient([withFetch(fetchFn)]);
    const stream = client.request('/fresh', readJson);

    expect((await collect(stream))[0]).toEqual({ attempt: 1 });
    expect((await collect(stream))[0]).toEqual({ attempt: 2 });
    expect(fetchCount).toBe(2);
  });

  it('useRetry does not retry aborted requests', async () => {
    const attempts: string[] = [];
    const controller = new AbortController();

    const fetchFn = (async (request: Request) => {
      attempts.push(`attempt-${attempts.length + 1}`);
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      });
    }) as unknown as typeof fetch;

    const client = createHttpClient([withFetch(fetchFn), useRetry(3, 1)]);
    const pending = collect(client.request('/abort', readJson, { signal: controller.signal }));
    controller.abort();

    await expectAsync(pending).toBeRejected();
    expect(attempts).toEqual(['attempt-1']);
  });
});
