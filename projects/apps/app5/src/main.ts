import { catchError } from '@epikodelabs/streamix';
import {
  createHttpClient,
  readArrayBuffer,
  readBlob,
  readJson,
  readStatus,
  readText,
  useAccept,
  useBase,
  useFallback,
  useHeader,
  useLogger,
  useRedirect,
  useStripHeaders,
  useTimeout,
} from '@epikodelabs/streamix/networking';

/* ─── Helpers ─── */
const setOutput = (key: string, content: string) => {
  const el = document.querySelector(`[data-output="${key}"]`);
  if (!el) return;
  if (el.tagName === 'PRE') {
    el.textContent = content;
  } else {
    el.innerHTML = content;
  }
};

const setLoading = (key: string) => setOutput(key, 'Loading…');

/* ─── 1. GET posts (JSON) ─── */
const fetchPosts = async () => {
  setLoading('posts');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://jsonplaceholder.typicode.com'))
    .withDefaults(useAccept('application/json'))
    .withDefaults(useLogger())
    .withDefaults(useTimeout(8000))
    .withDefaults(useFallback((err, ctx) => { console.error('Fallback:', err); return ctx; }));

  try {
    for await (const value of client.get('/posts?_limit=3', readJson)) {
      setOutput('posts', JSON.stringify(value, null, 2));
    }
  } catch (err: any) {
    setOutput('posts', `Error: ${err.message || err}`);
  }
};

/* ─── 2. POST post (JSON) ─── */
const createPost = async () => {
  setLoading('create');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://jsonplaceholder.typicode.com'))
    .withDefaults(useHeader('Content-Type', 'application/json'))
    .withDefaults(useAccept('application/json'))
    .withDefaults(useLogger())
    .withDefaults(useTimeout(8000));

  try {
    for await (const value of client.post(
      '/posts',
      { body: { title: 'Streamix HTTP', body: 'Reactive networking', userId: 1 } },
      readJson,
    )) {
      setOutput('create', JSON.stringify(value, null, 2));
    }
  } catch (err: any) {
    setOutput('create', `Error: ${err.message || err}`);
  }
};

/* ─── 3. GET users (raw text) ─── */
const fetchUsers = async () => {
  setLoading('users');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://jsonplaceholder.typicode.com'))
    .withDefaults(useAccept('application/json'))
    .withDefaults(useLogger())
    .withDefaults(useTimeout(8000));

  try {
    for await (const value of client.get('/users?_limit=3', readText)) {
      setOutput('users', String(value));
    }
  } catch (err: any) {
    setOutput('users', `Error: ${err.message || err}`);
  }
};

/* ─── 4. GET pokemon (JSON) ─── */
const fetchPokemon = async () => {
  setLoading('pokemon');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://pokeapi.co'))
    .withDefaults(useAccept('application/json'))
    .withDefaults(useLogger())
    .withDefaults(useTimeout(8000));

  try {
    for await (const value of client.get('/api/v2/pokemon/pikachu', readJson)) {
      setOutput('pokemon', JSON.stringify(value, null, 2));
    }
  } catch (err: any) {
    setOutput('pokemon', `Error: ${err.message || err}`);
  }
};

/* ─── 5. GET dog image (JSON URL → Blob) ─── */
const fetchDog = async () => {
  setLoading('dog');

  // Step 1: fetch metadata JSON to get the image URL
  const metaClient = createHttpClient();
  metaClient
    .withDefaults(useBase('https://dog.ceo'))
    .withDefaults(useStripHeaders('Content-Type'))
    .withDefaults(useTimeout(8000));

  let imageUrl = '';
  try {
    for await (const value of metaClient.get('/api/breeds/image/random', readJson)) {
      imageUrl = (value as any).message;
    }
  } catch (err: any) {
    setOutput('dog', `Error fetching metadata: ${err.message || err}`);
    return;
  }

  if (!imageUrl) {
    setOutput('dog', 'Error: no image URL in response');
    return;
  }

  // Step 2: fetch actual image as a Blob
  const imgClient = createHttpClient();
  imgClient
    .withDefaults(useStripHeaders('Content-Type'))
    .withDefaults(useTimeout(15000));

  try {
    for await (const blob of imgClient.get(imageUrl, readBlob)) {
      const url = URL.createObjectURL(blob as Blob);
      setOutput('dog', `<img src="${url}" alt="Random dog" style="max-width:100%;border-radius:8px;" />`);
    }
  } catch (err: any) {
    setOutput('dog', `Error fetching image: ${err.message || err}`);
  }
};

/* ─── 6. 404 Not Found (text + catchError) ─── */
const test404 = async () => {
  setLoading('404');
  const client = createHttpClient();
  client.withDefaults(useBase('https://jsonplaceholder.typicode.com'));

  const stream = client
    .get('/nonexistent-endpoint-12345', readText)
    .pipe(catchError((err: any) => { setOutput('404', `Caught 404: ${err.message || err}`); }));

  try {
    for await (const value of stream) {
      setOutput('404', String(value) || 'Empty 404 response');
    }
  } catch (err: any) {
    setOutput('404', `Unhandled: ${err.message || err}`);
  }
};

/* ─── 7. Redirects (readStatus) ─── */
const testRedirect = async () => {
  setLoading('redirect');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://httpbin.org'))
    .withDefaults(useRedirect(5))
    .withDefaults(useLogger())
    .withDefaults(useTimeout(8000));

  try {
    for await (const value of client.get('/redirect/3', readStatus)) {
      setOutput('redirect', JSON.stringify(value, null, 2));
    }
  } catch (err: any) {
    setOutput('redirect', `Error: ${err.message || err}`);
  }
};

/* ─── 8. Timeout (ArrayBuffer + catchError) ─── */
const testTimeout = async () => {
  setLoading('timeout');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://jsonplaceholder.typicode.com'))
    .withDefaults(useTimeout(1));

  const stream = client
    .get('/posts', readArrayBuffer)
    .pipe(catchError((err: any) => { setOutput('timeout', `Caught timeout: ${err.message || err}`); }));

  try {
    for await (const value of stream) {
      setOutput('timeout', `Received ${(value as ArrayBuffer).byteLength} bytes`);
    }
  } catch (err: any) {
    setOutput('timeout', `Unhandled: ${err.message || err}`);
  }
};

/* ─── Wire up buttons ─── */
const actions: Record<string, () => Promise<void>> = {
  'fetch-posts': fetchPosts,
  'create-post': createPost,
  'fetch-users': fetchUsers,
  'fetch-pokemon': fetchPokemon,
  'fetch-dog': fetchDog,
  'test-404': test404,
  'test-redirect': testRedirect,
  'test-timeout': testTimeout,
};

document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = (btn as HTMLElement).dataset['action'];
    if (action && actions[action]) {
      actions[action]();
    }
  });
});
