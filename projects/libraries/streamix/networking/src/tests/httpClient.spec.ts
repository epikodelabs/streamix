import {
  createHttpClient,
  Middleware,
  readArrayBuffer,
  readBase64Chunk,
  readBinaryChunk,
  readBlob,
  readChunks,
  readCsvChunk,
  readFull,
  readJson,
  readJsonChunk,
  readNdjsonChunk,
  readStatus,
  readText,
  useAccept,
  useBase,
  useCustom,
  useFallback,
  useHeader,
  useLogger,
  useOauth,
  useParams,
  useRedirect,
  useRetry,
  useTimeout,
  type Context
} from '@epikodelabs/streamix/networking';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  if (!stream) {
    throw new Error('collect() was called with undefined. A middleware likely failed during initialization.');
  }
  const out: T[] = [];
  for await (const v of stream) out.push(v);
  return out;
}

function mockFetchSequence(responses: Array<(req?: Request) => Promise<Response>>) {
  let i = 0;
  return jasmine.createSpy('fetch').and.callFake((req: Request) => {
    const fn = responses[i++];
    if (!fn) throw new Error('Unexpected fetch call');
    return fn(req);
  });
}

function jsonResponse(data: any, init: Partial<ResponseInit> = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function clientWithFetch(fetch: Function) {
  return createHttpClient().withDefaults(
    useCustom(fetch),
    useBase('http://test.local'),
  );
}

function createMockReadableStream(chunks: Uint8Array[]) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
}

/* ================================================== */
/* 1. Basic Functionality & HTTP Methods              */
/* ================================================== */

describe('httpClient', () => {
  it('streams parsed JSON response', async () => {
    const fetch = mockFetchSequence([async () => jsonResponse({ ok: true })]);

    const client = clientWithFetch(fetch);
    const values = await collect(client.get('/test', readJson));

    expect(values).toEqual([{ ok: true }]);
  });

  it('parses status metadata', async () => {
    const fetch = mockFetchSequence([
      async () => new Response(null, { status: 204, statusText: 'No Content' }),
    ]);

    const client = clientWithFetch(fetch);
    const values = await collect(client.get('/status', readStatus));

    expect(values[0].status).toBe(204);
    expect(values[0].statusText).toBe('No Content');
  });

  it('supports POST requests', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.method).toBe('POST');
      const body = await req.json();
      expect(body).toEqual({ data: 'test' });
      return jsonResponse({ success: true });
    });

    const client = clientWithFetch(fetch);
    await collect(client.post('/create', { body: { data: 'test' } }, readJson));
  });

  it('supports PUT requests', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.method).toBe('PUT');
      return jsonResponse({ updated: true });
    });

    const client = clientWithFetch(fetch);
    await collect(client.put('/update', { body: { id: 1 } }, readJson));
  });

  it('supports PATCH requests', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.method).toBe('PATCH');
      return jsonResponse({ patched: true });
    });

    const client = clientWithFetch(fetch);
    await collect(client.patch('/partial', { body: { field: 'value' } }, readJson));
  });

  it('supports DELETE requests', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.method).toBe('DELETE');
      return jsonResponse({ deleted: true });
    });

    const client = clientWithFetch(fetch);
    await collect(client.delete('/item/1', {}, readJson));
  });

  it('handles parser as second argument', async () => {
    const fetch = mockFetchSequence([async () => jsonResponse({ ok: true })]);

    const client = clientWithFetch(fetch);
    const values = await collect(client.get('/test', readJson));

    expect(values).toEqual([{ ok: true }]);
  });

  it('handles options and parser as separate arguments', async () => {
    const fetch = mockFetchSequence([async () => jsonResponse({ ok: true })]);

    const client = clientWithFetch(fetch);
    const values = await collect(client.get('/test', { headers: { 'X-Custom': 'value' } }, readJson));

    expect(values).toEqual([{ ok: true }]);
  });

  it('uses readStatus as default parser', async () => {
    const fetch = mockFetchSequence([async () => new Response(null, { status: 200 })]);

    const client = clientWithFetch(fetch);
    const values = await collect(client.get('/test', {}));

    expect(values[0].status).toBe(200);
  });

  it('handles FormData body', async () => {
    const formData = new FormData();
    formData.append('key', 'value');

    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      const body = await req.text();
      expect(body).toContain('key');
      return jsonResponse({ ok: true });
    });

    const client = clientWithFetch(fetch);
    await collect(client.post('/form', { body: formData }, readJson));
  });

  it('handles URLSearchParams body', async () => {
    const params = new URLSearchParams();
    params.append('key', 'value');

    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      const body = await req.text();
      expect(body).toContain('key=value');
      return jsonResponse({ ok: true });
    });

    const client = clientWithFetch(fetch);
    await collect(client.post('/params', { body: params }, readJson));
  });

  it('handles withCredentials option', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.credentials).toBe('include');
      return jsonResponse({ ok: true });
    });

    const client = clientWithFetch(fetch);
    await collect(client.get('/secure', { withCredentials: true }, readJson));
  });

  it('handles absolute HTTP URLs', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.url).toBe('http://example.com/test');
      return jsonResponse({ ok: true });
    });

    const client = createHttpClient().withDefaults(useCustom(fetch));
    await collect(client.get('http://example.com/test', readJson));
  });

  it('handles absolute HTTPS URLs', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.url).toBe('https://example.com/test');
      return jsonResponse({ ok: true });
    });

    const client = createHttpClient().withDefaults(useCustom(fetch));
    await collect(client.get('https://example.com/test', readJson));
  });

  it('throws on non-ok response', async () => {
    const fetch = mockFetchSequence([async () => new Response('fail', { status: 500 })]);

    const client = clientWithFetch(fetch);

    await expectAsync(collect(client.get('/error', readJson))).toBeRejectedWithError(/HTTP Error/);
  });

  it('aborts request stream', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(
      async () =>
        new Promise((_r, reject) => setTimeout(() => reject({ name: 'AbortError' }), 10)),
    );

    const client = clientWithFetch(fetch);
    const stream = client.get('/abort', readJson);

    stream.abort();

    await expectAsync(collect(stream)).toBeRejected();
  });

  it('handles null body', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.body).toBeNull();
      return jsonResponse({ ok: true });
    });

    const client = clientWithFetch(fetch);
    await collect(client.post('/null-body', { body: null }, readJson));
  });

  it('handles undefined body', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.body).toBeNull();
      return jsonResponse({ ok: true });
    });

    const client = clientWithFetch(fetch);
    await collect(client.post('/undefined-body', {}, readJson));
  });

  it('handles absolute URL without base middleware', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.url).toBe('https://external.api/data');
      return jsonResponse({ external: true });
    });

    const client = createHttpClient().withDefaults(useCustom(fetch));
    await collect(client.get('https://external.api/data', readJson));
  });
});

/* ================================================== */
/* 2. Middleware                                      */
/* ================================================== */

describe('middleware', () => {
  it('applies base URL and headers', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.url).toBe('https://api.test/users');
      expect(req.headers.get('Accept')).toBe('application/json');
      expect(req.headers.get('X-Test')).toBe('1');
      return jsonResponse({ ok: true });
    });

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('https://api.test'),
      useAccept('application/json'),
      useHeader('X-Test', '1'),
    );

    await collect(client.get('/users', readJson));
  });

  it('adds query parameters', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.url).toContain('a=1');
      expect(req.url).toContain('b=2');
      return jsonResponse({ ok: true });
    });

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useParams({ a: '1', b: '2' }),
    );

    await collect(client.get('/test', readJson));
  });

  it('merges query parameters from middleware and options', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.url).toContain('a=1');
      expect(req.url).toContain('b=2');
      expect(req.url).toContain('c=3');
      return jsonResponse({ ok: true });
    });

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useParams({ a: '1', b: '2' }),
    );

    await collect(client.get('/test', { params: { c: '3' } }, readJson));
  });

  it('logs requests and responses', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const fetch = mockFetchSequence([async () => jsonResponse({ ok: true })]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useLogger(logger),
    );

    await collect(client.get('/log', readJson));

    expect(logs.length).toBe(2);
    expect(logs[0]).toContain('Request: GET');
    expect(logs[1]).toContain('Response: 200');
  });

  it('logs with default console.log', async () => {
    const logSpy = spyOn(console, 'log').and.stub();

    const fetch = mockFetchSequence([async () => jsonResponse({ ok: true })]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useLogger(),
    );

    await collect(client.get('/log', readJson));

    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it('throws timeout error', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      return new Promise((_, reject) => {
        const timeout = setTimeout(() => reject(new Error('Should have been aborted')), 1000);
        req.signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useTimeout(10),
    );

    await expectAsync(collect(client.get('/slow', readJson))).toBeRejectedWithError(/timed out/);
  });

  it('clears timeout on successful request', async () => {
    const fetch = mockFetchSequence([async () => jsonResponse({ ok: true })]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useTimeout(1000),
    );

    const values = await collect(client.get('/fast', readJson));
    expect(values).toEqual([{ ok: true }]);
  });

  it('catches and handles errors', async () => {
    const fetch = mockFetchSequence([async () => Promise.reject(new Error('Network error'))]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useFallback((error, context) => {
        context.data = (async function* () {
          yield { error: error.message };
        })() as any;
        return context;
      }),
    );

    const values = await collect(client.get('/fail', readJson));
    expect(values[0].error).toBe('Network error');
  });

  beforeEach(() => {
    spyOn(console, 'warn').and.callFake(() => {}); // no need to store if you don't assert on it
  });

  it('retries failed request', async () => {
    const fetch = mockFetchSequence([
      async () => Promise.reject(new Error('fail')),
      async () => jsonResponse({ ok: true }),
    ]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useRetry(1, 1),
    );

    const values = await collect(client.get('/retry', readJson));

    expect(values).toEqual([{ ok: true }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('respects shouldRetry function', async () => {
    const fetch = mockFetchSequence([async () => Promise.reject(new Error('No retry'))]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useRetry(3, 1, (error) => error.message !== 'No retry'),
    );

    await expectAsync(collect(client.get('/no-retry', readJson))).toBeRejectedWithError('No retry');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('adds authorization header', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.headers.get('Authorization')).toBe('Bearer token1');
      return jsonResponse({ ok: true });
    });

    const getToken = jasmine.createSpy().and.resolveTo('token1');
    const refreshToken = jasmine.createSpy().and.resolveTo('token2');

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useOauth({ getToken, refreshToken }),
    );

    await collect(client.get('/secure', readJson));
  });

  it('refreshes token on 401 when shouldRetry returns true', async () => {
    const fetch = mockFetchSequence([
      async () => new Response(null, { status: 401 }),
      async () => jsonResponse({ ok: true }),
    ]);

    const getToken = jasmine.createSpy().and.resolveTo('token1');
    const refreshToken = jasmine.createSpy().and.resolveTo('token2');

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useOauth({ getToken, refreshToken, shouldRetry: () => true }),
      useFallback((_error, context) => {
        context.data = (async function* () {
          yield { error: 'Handled' };
        })() as any;
        return context;
      }),
    );

    await collect(client.get('/secure', readJson));
    expect(refreshToken).toHaveBeenCalled();
  });

  it('follows various redirects', async () => {
    const statuses = [301, 302, 303, 307, 308];
    for (const status of statuses) {
      const fetch = mockFetchSequence([
        async () => new Response(null, { status, headers: { Location: '/next' } }),
        async (req?: Request) => {
          if (status === 303) expect(req?.method).toBe('GET');
          return jsonResponse({ ok: true });
        },
      ]);

      const client = createHttpClient().withDefaults(
        useCustom(fetch),
        useBase('http://test.local'),
        useRedirect(),
      );

      const values = await collect(client.get('/start', readJson));
      expect(values).toEqual([{ ok: true }]);
    }
  });

  it('throws on too many redirects', async () => {
    const fetch = mockFetchSequence([
      async () => new Response(null, { status: 302, headers: { Location: '/1' } }),
      async () => new Response(null, { status: 302, headers: { Location: '/2' } }),
      async () => new Response(null, { status: 302, headers: { Location: '/3' } }),
    ]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useRedirect(2),
    );

    await expectAsync(collect(client.get('/loop', readJson))).toBeRejectedWithError(/Too many redirects/);
  });

  it('throws on missing Location header', async () => {
    const fetch = mockFetchSequence([
      async () =>
        new Response(null, {
          status: 302,
          headers: new Headers({ 'Content-Type': 'text/plain' }),
        }),
    ]);

    const detectRedirects: Middleware = (next) => async (context) => {
      const result = await next(context);
      if (result instanceof Response) {
        return {
          ...context,
          ok: result.ok,
          status: result.status,
          statusText: result.statusText,
          redirectTo: result.headers.get('Location') || undefined,
          parser: context.parser,
          fetch: context.fetch,
        } as Context;
      }
      return result;
    };

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      detectRedirects,
      useBase('http://test.local'),
      useRedirect(),
    );

    await expectAsync(collect(client.get('/bad-redirect', readJson))).toBeRejectedWithError(/Location/);
  });

  it('chains multiple middlewares correctly', async () => {
    const logs: string[] = [];
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.url).toContain('https://api.test');
      expect(req.headers.get('Accept')).toBe('application/json');
      expect(req.headers.get('X-Custom')).toBe('header-value');
      return jsonResponse({ ok: true });
    });

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('https://api.test'),
      useAccept('application/json'),
      useHeader('X-Custom', 'header-value'),
      useLogger((msg) => logs.push(msg)),
      useParams({ key: 'value' }),
    );

    await collect(client.get('/test', readJson));

    expect(logs.length).toBe(2);
    expect(fetch).toHaveBeenCalled();
  });

  it('applies middleware in correct order', async () => {
    const order: string[] = [];

    const middleware1 = (next: any) => async (ctx: Context) => {
      order.push('1-before');
      const result = await next(ctx);
      order.push('1-after');
      return result;
    };

    const middleware2 = (next: any) => async (ctx: Context) => {
      order.push('2-before');
      const result = await next(ctx);
      order.push('2-after');
      return result;
    };

    const fetch = mockFetchSequence([async () => {
      order.push('fetch');
      return jsonResponse({ ok: true });
    }]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      middleware1,
      middleware2,
    );

    await collect(client.get('/order', readJson));

    expect(order).toEqual(['1-before', '2-before', 'fetch', '2-after', '1-after']);
  });

  it('preserves context custom properties through middleware', async () => {
    const customMiddleware = (next: any) => async (ctx: Context) => {
      ctx['customProperty'] = 'custom-value';
      return await next(ctx);
    };

    const verifyMiddleware = (next: any) => async (ctx: Context) => {
      expect(ctx['customProperty']).toBe('custom-value');
      return await next(ctx);
    };

    const fetch = mockFetchSequence([async () => jsonResponse({ ok: true })]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      customMiddleware,
      verifyMiddleware,
    );

    await collect(client.get('/custom', readJson));
  });

  it('handles empty params in useParams', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(async (req: Request) => {
      expect(req.url).toBe('http://test.local/test');
      return jsonResponse({ ok: true });
    });

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useParams({}),
    );

    await collect(client.get('/test', readJson));
  });
});

/* ================================================== */
/* 3. Parsers & Streaming                             */
/* ================================================== */

describe('parsers', () => {
  let warnSpy: jasmine.Spy;

  beforeEach(() => {
    warnSpy = spyOn(console, 'warn').and.callFake(() => {});  // Silences all warnings
  });

  afterEach(() => {
    warnSpy.calls.reset();
  });

  it('parses text response', async () => {
    const fetch = mockFetchSequence([async () => new Response('Hello World', { status: 200 })]);

    const client = clientWithFetch(fetch);
    const values = await collect(client.get('/text', readText));

    expect(values).toEqual(['Hello World']);
  });

  it('parses ArrayBuffer response', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const fetch = mockFetchSequence([async () => new Response(data, { status: 200 })]);

    const client = clientWithFetch(fetch);
    const values = await collect(client.get('/binary', readArrayBuffer));

    expect(values[0]).toBeInstanceOf(ArrayBuffer);
  });

  it('parses Blob response', async () => {
    const fetch = mockFetchSequence([async () => new Response('blob data', { status: 200 })]);

    const client = clientWithFetch(fetch);
    const values = await collect(client.get('/blob', readBlob));

    expect(values[0]).toBeInstanceOf(Blob);
  });

  it('throws error when response body is not readable', async () => {
    const response = new Response(null);
    Object.defineProperty(response, 'body', { value: null });

    await expectAsync((async () => {
      for await (const _ of readChunks()(response)) { /* no-op */ }
    })()).toBeRejectedWithError(/not readable/);
  });

  it('parses text chunks', async () => {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode('Hello'), encoder.encode(' World')];

    const response = new Response(createMockReadableStream(chunks), {
      headers: { 'Content-Type': 'text/plain' },
    });

    const values = await collect(readChunks()(response));

    expect(values.length).toBeGreaterThan(0);
    expect(values[values.length - 1].done).toBeTrue();
  });

  it('parses NDJSON chunks', async () => {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode('{"a":1}\n{"b":2}\n')];

    const response = new Response(createMockReadableStream(chunks), {
      headers: { 'Content-Type': 'application/x-ndjson' },
    });

    const values = await collect(readChunks<any>(readNdjsonChunk)(response));

    const dataChunks = values.filter((v) => !v.done);
    expect(dataChunks.length).toBe(2);
  });

  it('parses binary chunks', async () => {
    const chunks = [new Uint8Array([1, 2, 3])];

    const response = new Response(createMockReadableStream(chunks), {
      headers: { 'Content-Type': 'application/octet-stream' },
    });

    const values = await collect(readChunks<Uint8Array>(readBinaryChunk)(response));

    expect(values[0].chunk).toBeInstanceOf(Uint8Array);
  });

  it('calculates progress with Content-Length', async () => {
    const encoder = new TextEncoder();
    const data = encoder.encode('Hello');
    const chunks = [data];

    const response = new Response(createMockReadableStream(chunks), {
      headers: { 'Content-Type': 'text/plain', 'Content-Length': String(data.length) },
    });

    const values = await collect(readChunks()(response));

    expect(values[values.length - 1].progress).toBe(1);
  });

  it('handles chunks without Content-Length', async () => {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode('Hello')];

    const response = new Response(createMockReadableStream(chunks));

    const values = await collect(readChunks()(response));
    expect(values.length).toBeGreaterThan(0);
  });

  it('parses JSON chunks with custom parser', async () => {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode('{"test": true}')];

    const response = new Response(createMockReadableStream(chunks), {
      headers: { 'Content-Type': 'application/json' },
    });

    const values = await collect(readChunks<any>(readJsonChunk)(response));

    expect(values[0].chunk.test).toBeTrue();
  });

  it('handles invalid JSON/NDJSON chunks gracefully', () => {
    expect(readJsonChunk('invalid json')).toBeNull();
    expect(readNdjsonChunk('invalid json')).toBeNull();
  });

  it('converts chunks to Base64', () => {
    const chunk = new Uint8Array([72, 101, 108, 108, 111]);
    expect(readBase64Chunk(chunk)).toBe('SGVsbG8=');
  });

  it('parses CSV chunks', () => {
    const csvData = 'name,age\nJohn,30\nJane,25';
    expect(readCsvChunk(csvData)).toEqual([
      ['name', 'age'],
      ['John', '30'],
      ['Jane', '25'],
    ]);
  });

  it('reads full response body', async () => {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode('Hello'), encoder.encode(' World')];

    const response = new Response(createMockReadableStream(chunks));

    const values = await collect(readFull(response));

    expect(values[0]).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(values[0]);
    expect(text).toBe('Hello World');
  });

  it('handles parser errors in stream', async () => {
    const fetch = mockFetchSequence([async () => new Response('invalid json', { status: 200 })]);

    const client = clientWithFetch(fetch);

    await expectAsync(collect(client.get('/bad-json', readJson))).toBeRejected();
  });

  it('propagates errors through stream', async () => {
    const errorParser = async function* () {
      throw new Error('Parser error');
    };

    const fetch = mockFetchSequence([async () => jsonResponse({ ok: true })]);

    const client = clientWithFetch(fetch);

    await expectAsync(collect(client.get('/error-parser', {}, errorParser))).toBeRejectedWithError('Parser error');
  });
});