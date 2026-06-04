import { catchError } from '@epikodelabs/streamix';
import {
  createHttpClient,
  readJson,
  readText,
  useAccept,
  useBase,
  useFallback,
  useHeader,
  useLogger,
  useRedirect,
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

/* ─── 1. GET posts ─── */
const fetchPosts = async () => {
  setLoading('posts');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://jsonplaceholder.typicode.com'))
    .withDefaults(useAccept('application/json'))
    .withDefaults(useLogger())
    .withDefaults(useTimeout(8000))
    .withDefaults(useFallback((err, ctx) => { console.error('Fallback:', err); return ctx; }));

  const stream = client.get('/posts?_limit=3', readJson);
  try {
    for await (const value of stream) {
      setOutput('posts', JSON.stringify(value, null, 2));
    }
  } catch (err) {
    setOutput('posts', `Error: ${err}`);
  }
};

/* ─── 2. POST post ─── */
const createPost = async () => {
  setLoading('create');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://jsonplaceholder.typicode.com'))
    .withDefaults(useHeader('Content-Type', 'application/json'))
    .withDefaults(useAccept('application/json'))
    .withDefaults(useLogger())
    .withDefaults(useTimeout(8000));

  const stream = client.post(
    '/posts',
    { body: { title: 'Streamix HTTP', body: 'Reactive networking', userId: 1 } },
    readJson,
  );
  try {
    for await (const value of stream) {
      setOutput('create', JSON.stringify(value, null, 2));
    }
  } catch (err) {
    setOutput('create', `Error: ${err}`);
  }
};

/* ─── 3. GET users ─── */
const fetchUsers = async () => {
  setLoading('users');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://reqres.in'))
    .withDefaults(useAccept('application/json'))
    .withDefaults(useLogger())
    .withDefaults(useTimeout(5000));

  const stream = client.get('/api/users?page=1', readJson);
  try {
    for await (const value of stream) {
      setOutput('users', JSON.stringify(value, null, 2));
    }
  } catch (err) {
    setOutput('users', `Error: ${err}`);
  }
};

/* ─── 4. GET pokemon ─── */
const fetchPokemon = async () => {
  setLoading('pokemon');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://pokeapi.co'))
    .withDefaults(useAccept('application/json'))
    .withDefaults(useTimeout(8000));

  const stream = client.get('/api/v2/pokemon/pikachu', readJson);
  try {
    for await (const value of stream) {
      const data = value as any;
      const summary = {
        name: data.name,
        height: data.height,
        weight: data.weight,
        types: data.types.map((t: any) => t.type.name),
        abilities: data.abilities.map((a: any) => a.ability.name),
      };
      setOutput('pokemon', JSON.stringify(summary, null, 2));
    }
  } catch (err) {
    setOutput('pokemon', `Error: ${err}`);
  }
};

/* ─── 5. GET random dog ─── */
const fetchDog = async () => {
  setLoading('dog');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://dog.ceo'))
    .withDefaults(useAccept('application/json'))
    .withDefaults(useTimeout(8000));

  const stream = client.get('/api/breeds/image/random', readJson);
  try {
    for await (const value of stream) {
      const data = value as any;
      setOutput('dog', `<img src="${data.message}" alt="Random dog" style="max-width:100%;border-radius:8px;" />`);
    }
  } catch (err) {
    setOutput('dog', `Error: ${err}`);
  }
};

/* ─── 6. 404 Not Found ─── */
const test404 = async () => {
  setLoading('404');
  const client = createHttpClient();
  client.withDefaults(useBase('https://httpbin.org'));

  const stream = client
    .get('/status/404', readText)
    .pipe(catchError((err) => { setOutput('404', `Caught 404: ${err}`); }));

  try {
    for await (const value of stream) {
      setOutput('404', String(value));
    }
  } catch (err) {
    setOutput('404', `Unhandled error: ${err}`);
  }
};

/* ─── 7. Redirects ─── */
const testRedirect = async () => {
  setLoading('redirect');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://httpbin.org'))
    .withDefaults(useRedirect(3));

  const stream = client.get('/redirect/2', readJson);
  try {
    for await (const value of stream) {
      setOutput('redirect', JSON.stringify(value, null, 2));
    }
  } catch (err) {
    setOutput('redirect', `Error: ${err}`);
  }
};

/* ─── 8. Timeout ─── */
const testTimeout = async () => {
  setLoading('timeout');
  const client = createHttpClient();
  client
    .withDefaults(useBase('https://httpbin.org'))
    .withDefaults(useTimeout(1000));

  const stream = client
    .get('/delay/5', readText)
    .pipe(catchError((err) => { setOutput('timeout', `Caught timeout: ${err}`); }));

  try {
    for await (const value of stream) {
      setOutput('timeout', String(value));
    }
  } catch (err) {
    setOutput('timeout', `Unhandled error: ${err}`);
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
