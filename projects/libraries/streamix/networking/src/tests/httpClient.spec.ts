import {
  createHttpClient,
  readJson,
  readStatus,
  useFallback,
  useLogger,
  useOauth,
  useRequest,
  useRetry,
  useTimeout,
  type Context,
} from '@epikodelabs/streamix/networking';

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function withFetch(fetch: typeof globalThis.fetch) {
  return createHttpClient({ baseUrl: 'https://api.test' }).withDefaults(
    useRequest((context) => ({ ...context, fetch })),
  );
}

describe('http client', () => {
  it('resolves relative request URLs against the configured base URL', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (request: Request) => {
      expect(request.url).toBe('https://api.test/relative');
      return jsonResponse({ ok: true });
    });

    const client = createHttpClient({ baseUrl: 'https://api.test' }).withDefaults(
      useRequest((context) => ({ ...context, fetch: fetch as typeof globalThis.fetch })),
    );

    expect(await collect(client.request('/relative', readJson))).toEqual([{ ok: true }]);
  });

  it('binds the default fetch to globalThis', async () => {
    const originalFetch = globalThis.fetch;
    const boundFetch = jasmine.createSpy('fetch').and.callFake(function (this: typeof globalThis) {
      expect(this).toBe(globalThis);
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    (globalThis as typeof globalThis & { fetch: typeof globalThis.fetch }).fetch =
      boundFetch as typeof globalThis.fetch;

    try {
      const client = createHttpClient();
      expect(await collect(client.request('/bound', readJson))).toEqual([{ ok: true }]);
    } finally {
      (globalThis as typeof globalThis & { fetch: typeof globalThis.fetch }).fetch = originalFetch;
    }
  });

  it('uses request() as the only HTTP operation', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (request: Request) => {
      expect(request.method).toBe('POST');
      expect(await request.text()).toBe('{"ok":true}');
      return jsonResponse({ created: true });
    });

    const client = withFetch(fetch as typeof globalThis.fetch);
    const values = await collect(client.request('/items', readJson, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }));

    expect(values).toEqual([{ created: true }]);
  });

  it('does not inject default headers or serialize bodies', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (request: Request) => {
      expect(request.headers.get('Content-Type')).toBeNull();
      expect(await request.text()).toBe('raw-body');
      return jsonResponse({ ok: true });
    });

    const client = withFetch(fetch as typeof globalThis.fetch);
    await collect(client.request('/raw', readJson, { method: 'POST', body: 'raw-body' }));
  });

  it('passes native RequestInit through unchanged', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (request: Request) => {
      expect(request.credentials).toBe('include');
      expect(request.cache).toBe('no-store');
      expect(request.headers.get('X-Test')).toBe('1');
      return jsonResponse({ ok: true });
    });

    const client = withFetch(fetch as typeof globalThis.fetch);
    await collect(client.request('/native', readJson, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'X-Test': '1' },
    }));
  });

  it('throws for non-ok responses', async () => {
    const client = withFetch(async () => new Response('nope', { status: 500 }));
    await expectAsync(collect(client.request('/error', readJson))).toBeRejectedWithError(/HTTP Error/);
  });

  it('parses status only when readStatus is selected explicitly', async () => {
    const client = withFetch(async () => new Response(null, { status: 204, statusText: 'No Content' }));
    const [status] = await collect(client.request('/status', readStatus));
    expect(status.status).toBe(204);
    expect(status.statusText).toBe('No Content');
  });

  it('aborts the underlying request', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake((request: Request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      }),
    );

    const client = withFetch(fetch as typeof globalThis.fetch);
    const stream = client.request('/abort', readJson);
    stream.abort();
    await expectAsync(collect(stream)).toBeRejected();
  });

  it('combines caller cancellation with stream cancellation', async () => {
    const caller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const fetch = jasmine.createSpy('fetch').and.callFake((request: Request) => {
      seenSignal = request.signal;
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      });
    });

    const client = withFetch(fetch as typeof globalThis.fetch);
    const pending = collect(client.request('/abort', readJson, { signal: caller.signal }));
    caller.abort();
    await expectAsync(pending).toBeRejected();
    expect(seenSignal?.aborted).toBeTrue();
  });
});

describe('request transforms', () => {
  it('composes pure transforms in order', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (request: Request) => {
      expect(request.url).toBe('https://api.test/users');
      expect(request.headers.get('X-Step')).toBe('one-two');
      return jsonResponse({ ok: true });
    });

    const client = createHttpClient({ baseUrl: 'https://api.test' }).withDefaults(
      useRequest(
        (context) => {
          const headers = new Headers(context.init.headers);
          headers.set('X-Step', 'one');
          return { ...context, init: { ...context.init, headers } };
        },
        (context) => {
          const headers = new Headers(context.init.headers);
          headers.set('X-Step', `${headers.get('X-Step')}-two`);
          return { ...context, init: { ...context.init, headers }, fetch: fetch as typeof globalThis.fetch };
        },
      ),
    );

    await collect(client.request('/users', readJson));
  });

  it('keeps derived clients immutable', async () => {
    const requests: Request[] = [];
    const fetch = jasmine.createSpy('fetch').and.callFake(async (request: Request) => {
      requests.push(request);
      return jsonResponse({ ok: true });
    });

    const root = createHttpClient().withDefaults(
      useRequest((context) => ({ ...context, fetch: fetch as typeof globalThis.fetch })),
    );
    const authenticated = root.withDefaults(
      useRequest((context) => {
        const headers = new Headers(context.init.headers);
        headers.set('Authorization', 'Bearer token');
        return { ...context, init: { ...context.init, headers } };
      }),
    );

    await collect(root.request('/root', readJson));
    await collect(authenticated.request('/auth', readJson));

    expect(requests[0].headers.get('Authorization')).toBeNull();
    expect(requests[1].headers.get('Authorization')).toBe('Bearer token');
  });
});

describe('execution middleware', () => {
  it('logs request and response', async () => {
    const logs: string[] = [];
    const client = createHttpClient().withDefaults(
      useRequest((context) => ({ ...context, fetch: async () => jsonResponse({ ok: true }) })),
      useLogger((message) => logs.push(message)),
    );

    await collect(client.request('/log', readJson, { method: 'PATCH' }));
    expect(logs[0]).toContain('PATCH /log');
    expect(logs[1]).toContain('200');
  });

  it('returns fallback streams explicitly', async () => {
    const client = createHttpClient().withDefaults(
      useRequest((context) => ({ ...context, fetch: async () => new Response('bad', { status: 500 }) })),
      useFallback(async function* () { yield { fallback: true }; }),
    );

    expect(await collect(client.request('/fallback', readJson))).toEqual([{ fallback: true }]);
  });

  it('retries failures', async () => {
    let attempts = 0;
    const client = createHttpClient().withDefaults(
      useRequest((context) => ({
        ...context,
        fetch: async () => {
          attempts++;
          if (attempts < 3) throw new Error('retry');
          return jsonResponse({ ok: true });
        },
      })),
      useRetry(2, 0),
    );

    expect(await collect(client.request('/retry', readJson))).toEqual([{ ok: true }]);
    expect(attempts).toBe(3);
  });

  it('honors retry predicates', async () => {
    let attempts = 0;
    const client = createHttpClient().withDefaults(
      useRequest((context) => ({ ...context, fetch: async () => { attempts++; throw new Error('stop'); } })),
      useRetry(3, 0, () => false),
    );

    await expectAsync(collect(client.request('/retry', readJson))).toBeRejectedWithError('stop');
    expect(attempts).toBe(1);
  });

  it('refreshes OAuth tokens after 401', async () => {
    const authorizations: Array<string | null> = [];
    const fetch = jasmine.createSpy('fetch').and.callFake(async (request: Request) => {
      authorizations.push(request.headers.get('Authorization'));
      return authorizations.length === 1
        ? new Response('unauthorized', { status: 401 })
        : jsonResponse({ ok: true });
    });

    const client = createHttpClient().withDefaults(
      useRequest((context) => ({ ...context, fetch: fetch as typeof globalThis.fetch })),
      useOauth({
        getToken: async () => 'token-1',
        refreshToken: async () => 'token-2',
      }),
    );

    expect(await collect(client.request('/secure', readJson))).toEqual([{ ok: true }]);
    expect(authorizations).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('times requests out', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake((request: Request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    );

    const client = createHttpClient().withDefaults(
      useRequest((context) => ({ ...context, fetch: fetch as typeof globalThis.fetch })),
      useTimeout(1),
    );

    await expectAsync(collect(client.request('/slow', readJson))).toBeRejectedWithError(/timed out/);
  });

  it('exposes native redirect behavior instead of custom redirect middleware', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (request: Request) => {
      expect(request.redirect).toBe('manual');
      return jsonResponse({ ok: true });
    });

    const client = withFetch(fetch as typeof globalThis.fetch);
    await collect(client.request('/redirect', readJson, { redirect: 'manual' }));
  });

  it('lets transforms replace fetch without a dedicated helper', async () => {
    const customFetch = jasmine.createSpy('fetch').and.resolveTo(jsonResponse({ custom: true }));
    const transform = (context: Context): Context => ({
      ...context,
      fetch: customFetch as typeof globalThis.fetch,
    });

    const client = createHttpClient().withDefaults(useRequest(transform));
    expect(await collect(client.request('/custom', readJson))).toEqual([{ custom: true }]);
  });
});
