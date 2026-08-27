export type ParserFunction<T = unknown> = (response: Response) => AsyncIterable<T>;

type ByteSource = AsyncIterable<Uint8Array>;
type TextSource = AsyncIterable<string>;

function bodyError(response: Response): Error {
  return new Error(`Response body for ${response.url || 'unknown'} is not readable`);
}

/** Streams raw response-body bytes. */
export async function* responseBytes(response: Response): ByteSource {
  if (!response.body) throw bodyError(response);

  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Incrementally decodes byte chunks without splitting multi-byte characters. */
export async function* decodeText(
  source: ByteSource,
  encoding = 'utf-8',
): TextSource {
  const decoder = new TextDecoder(encoding);

  for await (const chunk of source) {
    const text = decoder.decode(chunk, { stream: true });
    if (text) yield text;
  }

  const tail = decoder.decode();
  if (tail) yield tail;
}

/** Frames arbitrary text chunks into lines and emits the final unterminated line. */
export async function* splitLines(source: TextSource): TextSource {
  let buffered = '';

  for await (const chunk of source) {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) yield line;
  }

  if (buffered) yield buffered;
}

export const readStatus: ParserFunction<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
}> = async function* (response) {
  yield {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  };
};

export const readJson = async function* <T = unknown>(
  response: Response,
): AsyncIterable<T> {
  yield (await response.json()) as T;
};

export const readText: ParserFunction<string> = async function* (response) {
  yield await response.text();
};

export const readArrayBuffer: ParserFunction<ArrayBuffer> = async function* (response) {
  yield await response.arrayBuffer();
};

export const readBlob: ParserFunction<Blob> = async function* (response) {
  yield await response.blob();
};
