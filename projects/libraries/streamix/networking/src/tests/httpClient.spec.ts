import {
    createHttpClient,
    readJson,
    readStatus,
    useAccept,
    useBase,
    useCustom,
    useHeader,
    useOauth,
    useParams,
    useRedirect,
    useRetry,
} from '@actioncrew/streamix/networking';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of stream) out.push(v);
  return out;
}

function mockFetchSequence(responses: Array<() => Promise<Response>>) {
  let i = 0;
  return jasmine.createSpy('fetch').and.callFake(() => {
    const fn = responses[i++];
    if (!fn) throw new Error('Unexpected fetch call');
    return fn();
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

/* -------------------------------------------------- */
/* Basic behavior                                     */
/* -------------------------------------------------- */

describe('HttpClient – basic behavior', () => {
  it('streams parsed JSON response', async () => {
    const fetch = mockFetchSequence([
      async () => jsonResponse({ ok: true }),
    ]);

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
});

/* -------------------------------------------------- */
/* Middleware                                         */
/* -------------------------------------------------- */

describe('HttpClient – middleware', () => {
  it('applies base URL and headers', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(
      async (req: Request) => {
        expect(req.url).toBe('https://api.test/users');
        expect(req.headers.get('Accept')).toBe('application/json');
        expect(req.headers.get('X-Test')).toBe('1');
        return jsonResponse({ ok: true });
      }
    );

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('https://api.test'),
      useAccept('application/json'),
      useHeader('X-Test', '1'),
    );

    await collect(client.get('/users', readJson));
  });

  it('adds query parameters', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(
      async (req: Request) => {
        expect(req.url).toContain('a=1');
        expect(req.url).toContain('b=2');
        return jsonResponse({ ok: true });
      }
    );

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useParams({ a: '1', b: '2' }),
    );

    await collect(client.get('/test', readJson));
  });
});

/* -------------------------------------------------- */
/* Abort                                              */
/* -------------------------------------------------- */

describe('HttpClient – abort', () => {
  it('aborts request stream', async () => {
    const fetch = jasmine.createSpy('fetch').and.callFake(
      async () =>
        new Promise((_r, reject) =>
          setTimeout(() => reject({ name: 'AbortError' }), 10)
        )
    );

    const client = clientWithFetch(fetch);
    const stream = client.get('/abort', readJson);

    stream.abort();

    try {
      await collect(stream);
      fail('Expected abort');
    } catch {
      expect(true).toBeTrue();
    }
  });
});

/* -------------------------------------------------- */
/* Retry                                              */
/* -------------------------------------------------- */

describe('HttpClient – retry', () => {
  let warnSpy: jasmine.Spy;

  beforeEach(() => {
    warnSpy = spyOn(console, 'warn').and.stub();
  });

  afterEach(() => {
    warnSpy.calls.reset();
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
});

/* -------------------------------------------------- */
/* OAuth                                              */
/* -------------------------------------------------- */

describe('HttpClient – OAuth', () => {
  it('throws on 401 (core throws, no retry)', async () => {
    const fetch = mockFetchSequence([
      async () => new Response(null, { status: 401 }),
    ]);

    const getToken = jasmine.createSpy().and.resolveTo('token1');
    const refreshToken = jasmine.createSpy().and.resolveTo('token2');

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useOauth({ getToken, refreshToken }),
    );

    try {
      await collect(client.get('/secure', readJson));
      fail('Expected 401');
    } catch (e: any) {
      expect(e.message).toContain('401');
    }

    expect(getToken).toHaveBeenCalled();
    expect(refreshToken).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------- */
/* Redirect                                           */
/* -------------------------------------------------- */

describe('HttpClient – redirect', () => {
  it('follows redirect', async () => {
    const fetch = mockFetchSequence([
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: '/next' },
        }),
      async () => jsonResponse({ ok: true }),
    ]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
      useRedirect(),
    );

    const values = await collect(client.get('/start', readJson));

    expect(values).toEqual([{ ok: true }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

/* -------------------------------------------------- */
/* Errors                                             */
/* -------------------------------------------------- */

describe('HttpClient – errors', () => {
  it('throws on non-ok response', async () => {
    const fetch = mockFetchSequence([
      async () => new Response('fail', { status: 500 }),
    ]);

    const client = createHttpClient().withDefaults(
      useCustom(fetch),
      useBase('http://test.local'),
    );

    try {
      await collect(client.get('/error', readJson));
      fail('Expected error');
    } catch (e: any) {
      expect(e.message).toContain('HTTP Error');
    }
  });
});
