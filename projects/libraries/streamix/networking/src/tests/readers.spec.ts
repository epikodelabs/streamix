import {
  decodeText,
  readArrayBuffer,
  readBlob,
  readJson,
  readStatus,
  readText,
  responseBytes,
  splitLines,
} from '@epikodelabs/streamix/networking';

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

function stream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
  });
}

describe('response readers', () => {
  it('reads status metadata', async () => {
    const response = new Response(null, { status: 204, statusText: 'No Content', headers: { 'X-Test': '1' } });
    const [value] = await collect(readStatus(response));
    expect(value.status).toBe(204);
    expect(value.statusText).toBe('No Content');
    expect(value.headers['x-test']).toBe('1');
  });

  it('provides explicit whole-response parsers', async () => {
    expect(await collect(readJson(new Response('{"x":1}')))).toEqual([{ x: 1 }]);
    expect(await collect(readText(new Response('hello')))).toEqual(['hello']);
    expect((await collect(readArrayBuffer(new Response('abc'))))[0].byteLength).toBe(3);
    expect((await collect(readBlob(new Response('abc'))))[0]).toEqual(jasmine.any(Blob));
  });

  it('streams raw response bytes', async () => {
    const encoder = new TextEncoder();
    const response = new Response(stream([encoder.encode('a'), encoder.encode('b')]));
    const chunks = await collect(responseBytes(response));
    expect(chunks.map((chunk) => new TextDecoder().decode(chunk))).toEqual(['a', 'b']);
  });

  it('decodes UTF-8 across byte boundaries', async () => {
    const bytes = new TextEncoder().encode('A🙂B');
    async function* source() {
      yield bytes.slice(0, 3);
      yield bytes.slice(3, 5);
      yield bytes.slice(5);
    }
    expect((await collect(decodeText(source()))).join('')).toBe('A🙂B');
  });

  it('frames lines and emits the final unterminated line', async () => {
    async function* source() {
      yield 'one\nt';
      yield 'wo\nthree';
    }
    expect(await collect(splitLines(source()))).toEqual(['one', 'two', 'three']);
  });
});
