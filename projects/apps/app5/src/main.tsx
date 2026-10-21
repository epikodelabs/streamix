import { catchError, pipe, scope } from "@epikodelabs/streamix";
import {
  createHttpClient,
  readArrayBuffer,
  readBlob,
  readJson,
  readStatus,
  readText,
  useFallback,
  useLogger,
  useRequest,
  useTimeout,
  type RequestTransform,
} from "@epikodelabs/streamix/networking";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

/* ─── Helpers ─── */
const withHeader = (name: string, value: string): RequestTransform => (context) => {
  const headers = new Headers(context.init.headers);
  headers.set(name, value);
  return { ...context, init: { ...context.init, headers } };
};

const jsonPlaceholder = () => createHttpClient({
  baseUrl: "https://jsonplaceholder.typicode.com",
  middlewares: [useRequest(withHeader("Accept", "application/json")), useLogger(), useTimeout(8000)],
});

/* ─── Card output plumbing ─── */
type CardOutput = { kind: "text"; text: string } | { kind: "image"; url: string };
type OutputSetter = (output: CardOutput) => void;
type CardAction = (set: OutputSetter) => Promise<void>;

const text = (value: string): CardOutput => ({ kind: "text", text: value });

/* ─── 1. GET posts (JSON) ─── */
const fetchPosts: CardAction = async (set) => {
  set(text("Loading…"));
  const client = jsonPlaceholder().withDefaults(useFallback((err) => {
    console.error("Fallback:", err);
    return (async function* () { yield { fallback: true }; })();
  }));
  try {
    for await (const value of client.request("/posts?_limit=3", readJson)) {
      set(text(JSON.stringify(value, null, 2)));
    }
  } catch (err: any) {
    set(text(`Error: ${err.message || err}`));
  }
};

/* ─── 2. POST post (JSON) ─── */
const createPost: CardAction = async (set) => {
  set(text("Loading…"));
  const client = jsonPlaceholder().withDefaults(useRequest(withHeader("Content-Type", "application/json")));
  try {
    for await (const value of client.request("/posts", readJson, {
      method: "POST",
      body: JSON.stringify({ title: "streamix HTTP", body: "Reactive networking", userId: 1 }),
    })) {
      set(text(JSON.stringify(value, null, 2)));
    }
  } catch (err: any) {
    set(text(`Error: ${err.message || err}`));
  }
};

/* ─── 3. GET users (raw text) ─── */
const fetchUsers: CardAction = async (set) => {
  set(text("Loading…"));
  const client = jsonPlaceholder();
  try {
    for await (const value of client.request("/users?_limit=3", readText)) {
      set(text(String(value)));
    }
  } catch (err: any) {
    set(text(`Error: ${err.message || err}`));
  }
};

/* ─── 4. GET pokemon (JSON) ─── */
const fetchPokemon: CardAction = async (set) => {
  set(text("Loading…"));
  const client = createHttpClient({
    baseUrl: "https://pokeapi.co",
    middlewares: [useRequest(withHeader("Accept", "application/json")), useLogger(), useTimeout(8000)],
  });
  try {
    for await (const value of client.request("/api/v2/pokemon/pikachu", readJson)) {
      set(text(JSON.stringify(value, null, 2)));
    }
  } catch (err: any) {
    set(text(`Error: ${err.message || err}`));
  }
};

/* ─── 5. GET dog image (JSON URL → Blob) ─── */
const fetchDog: CardAction = async (set) => {
  set(text("Loading…"));
  // Step 1: fetch metadata JSON to get the image URL
  const metaClient = createHttpClient({
    baseUrl: "https://dog.ceo",
    middlewares: [useTimeout(8000)],
  });
  let imageUrl = "";
  try {
    for await (const value of metaClient.request("/api/breeds/image/random", readJson)) {
      imageUrl = (value as any).message;
    }
  } catch (err: any) {
    set(text(`Error fetching metadata: ${err.message || err}`));
    return;
  }
  if (!imageUrl) {
    set(text("Error: no image URL in response"));
    return;
  }
  // Step 2: fetch actual image as a Blob
  const imgClient = createHttpClient({ middlewares: [useTimeout(15000)] });
  try {
    for await (const blob of imgClient.request(imageUrl, readBlob)) {
      set({ kind: "image", url: URL.createObjectURL(blob as Blob) });
    }
  } catch (err: any) {
    set(text(`Error fetching image: ${err.message || err}`));
  }
};

/* ─── 6. 404 Not Found (text + catchError) ─── */
const test404: CardAction = async (set) => {
  set(text("Loading…"));
  const client = createHttpClient({ baseUrl: "https://jsonplaceholder.typicode.com" });
  const response$ = pipe(
    client.request("/nonexistent-endpoint-12345", readText),
    catchError((err: any) => { set(text(`Caught 404: ${err.message || err}`)); }),
  );
  try {
    for await (const value of response$) {
      set(text(String(value) || "Empty 404 response"));
    }
  } catch (err: any) {
    set(text(`Unhandled: ${err.message || err}`));
  }
};

/* ─── 7. Redirects (readStatus) ─── */
const testRedirect: CardAction = async (set) => {
  set(text("Loading…"));
  const client = createHttpClient({
    baseUrl: "https://httpbin.org",
    middlewares: [useLogger(), useTimeout(8000)],
  });
  try {
    for await (const value of client.request("/redirect/3", readStatus, { redirect: "follow" })) {
      set(text(JSON.stringify(value, null, 2)));
    }
  } catch (err: any) {
    set(text(`Error: ${err.message || err}`));
  }
};

/* ─── 8. Timeout (ArrayBuffer + catchError) ─── */
const testTimeout: CardAction = async (set) => {
  set(text("Loading…"));
  const client = createHttpClient({
    baseUrl: "https://jsonplaceholder.typicode.com",
    middlewares: [useTimeout(1)],
  });
  const response$ = pipe(
    client.request("/posts", readArrayBuffer),
    catchError((err: any) => { set(text(`Caught timeout: ${err.message || err}`)); }),
  );
  try {
    for await (const value of response$) {
      set(text(`Received ${(value as ArrayBuffer).byteLength} bytes`));
    }
  } catch (err: any) {
    set(text(`Unhandled: ${err.message || err}`));
  }
};

/* ─── UI ─── */
function DemoCard({ title, badge, tooltip, image = false, action }: {
  title: string;
  badge: string;
  tooltip: string;
  image?: boolean;
  action: CardAction;
}) {
  // The compiler gives each card its own stable, disposable scope. Keeping
  // output in Streamix also makes the demo's state visible before a request.
  const output = scope({ body: "", imageUrl: "" });

  useEffect(() => () => {
    if (output.imageUrl) URL.revokeObjectURL(output.imageUrl);
  }, []);

  const set: OutputSetter = (next) => {
    if (output.imageUrl) URL.revokeObjectURL(output.imageUrl);
    if (next.kind === "image") {
      output.body = "";
      output.imageUrl = next.url;
    } else {
      output.imageUrl = "";
      output.body = next.text;
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>{title}</h2>
        <span className="badge">{badge}</span>
      </div>
      <p className="tooltip">{tooltip}</p>
      <button onClick={() => void action(set)}>Run Request</button>
      {image ? (
        <div className="image-output">{output.imageUrl ? <img src={output.imageUrl} alt="Random dog" /> : output.body}</div>
      ) : (
        <pre className="output">{output.body}</pre>
      )}
    </section>
  );
}

function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>🌐 HTTP Client Demo</h1>
        <p className="subtitle">streamix networking operators with real public APIs</p>
      </header>

      <main className="grid">
        <DemoCard
          title="GET /posts"
          badge="readJson"
          tooltip="Parses JSON response from JSONPlaceholder into structured objects."
          action={fetchPosts}
        />

        <DemoCard
          title="POST /posts"
          badge="readJson"
          tooltip="Creates a post with a JSON body and parses the JSON response."
          action={createPost}
        />

        <DemoCard
          title="GET /users"
          badge="readText"
          tooltip="Reads the raw response body as plain text instead of parsing JSON."
          action={fetchUsers}
        />

        <DemoCard
          title="GET /pokemon"
          badge="readJson"
          tooltip="Queries PokeAPI and parses the structured Pokémon data as JSON."
          action={fetchPokemon}
        />

        <DemoCard
          title="GET /random dog"
          badge="readJson → readBlob"
          tooltip="Fetches a JSON URL from Dog CEO, then streams the actual image as a Blob."
          image
          action={fetchDog}
        />

        <DemoCard
          title="404 Not Found"
          badge="readText + catchError"
          tooltip="Requests a missing endpoint and catches the HTTP error gracefully."
          action={test404}
        />

        <DemoCard
          title="Redirects"
          badge="useRedirect + readStatus"
          tooltip="Follows 3 redirects then reads the final HTTP status and headers metadata."
          action={testRedirect}
        />

        <DemoCard
          title="Timeout"
          badge="useTimeout + readArrayBuffer"
          tooltip="Sets a 1 ms timeout and requests an ArrayBuffer response to trigger abort."
          action={testTimeout}
        />
      </main>

      <footer className="footer">
        <p>Powered by <strong>streamix</strong> · HTTP networking for TypeScript</p>
      </footer>
    </div>
  );
}

const host = document.getElementById("app");
if (!host) {
  throw new Error("Missing #app host element.");
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
