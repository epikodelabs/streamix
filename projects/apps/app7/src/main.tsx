// @ts-nocheck -- compiled by @epikodelabs/streamix/react/builder before TypeScript checks JSX.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { atom, derived, flow, scope } from "@epikodelabs/streamix";

// A standalone atom: a compiler lowers `value={title}` through atomBinding().
let title = atom("Native atom property");
let clicks = atom(0);
let lastAction = atom("Waiting for input");
const summary = derived($ => `${$(title)} · ${$(clicks)} actions`);

// Write-operator targets: every compound, update, and logical assignment on a
// `let` atom lowers to an atom emission.
let tally = atom(2);
let power = atom(3);
let label = atom("");
let nullable = atom<number>();

// Static aliases, atom maps, and destructured map members keep atom identity:
// writing any of them emits through the same underlying atom.
const alias = clicks;
const model = { title, tally };
let { title: mappedTitle, tally: mappedTally } = model;
let swapped = atom(false);
let islandMounted = atom(true);

// A value-first scope: a compiler lowers `state.message` through
// scopeBinding(state, "message"), which keeps state.get("message") reactive.
const state = scope({
  message: "Scoped atom property",
  name: "Ada Lovelace",
  role: "Platform engineer",
  enabled: true,
  notifications: true,
  accent: "violet",
  connection: () => flow(async function* (signal) {
    yield "Connecting";
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    if (!signal.aborted) {
      yield "Synchronizing";
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    }
    if (!signal.aborted) {
      yield "Live";
      // Keep the flow alive at its final state until the owning scope disposes it.
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          resolve();
        }, { once: true });
      });
    }
  }),
});

// A component-local atom and scope: the compiler owns them for the mounted
// instance and disposes both when the instance unmounts.
function LocalIsland() {
  let hits = atom(0);
  const local = scope({ tone: "island-local" });

  return (
    <div className="island">
      <button type="button" onClick={() => hits++}>Local atom clicks: {hits}</button>
      <p className="muted">Scope tone: {local.tone} — owned by this component instance.</p>
    </div>
  );
}

function App() {
  return (
    <main className="demo">
      <header className="hero">
        <p className="eyebrow">Streamix × React</p>
        <span className="status">{state.connection ?? "Connecting…"}</span>
      </header>
      <h1>Direct atom JSX laboratory</h1>
      <p className="copy">
        A comprehensive compiler sample: standalone atoms, scope fields, derived
        values, scope-owned flows, write operators, component-local ownership,
        aliases and maps, and atom transport across component boundaries are all
        used directly in TSX.
      </p>

      <section className="dashboard">
        <article className="card profile-card">
          <div className="card-heading"><h2>Scoped profile</h2></div>
          <div className="grid">
            <label>
              Name
              <input value={state.name} onChange={(event) => state.name = event.target.value} />
            </label>
            <label>
              Role
              <input value={state.role} onChange={(event) => state.role = event.target.value} />
            </label>
            <label>
              Scoped message
              <input value={state.message} onChange={(event) => state.message = event.target.value} />
            </label>
            <label>
              Accent
              <select value={state.accent} onChange={(event) => state.accent = event.target.value}>
                <option value="violet">Violet</option>
                <option value="cyan">Cyan</option>
                <option value="lime">Lime</option>
              </select>
            </label>
          </div>
          <div className="toggles">
            <label className="toggle"><input type="checkbox" checked={state.enabled} onChange={(event) => state.enabled = event.target.checked} /> Enable workspace</label>
            <label className="toggle"><input type="checkbox" checked={state.notifications} onChange={(event) => state.notifications = event.target.checked} /> Notifications</label>
          </div>
        </article>

        <article className="card signal-card">
          <div className="card-heading"><h2>Standalone atoms</h2></div>
          <label>
            Atom-backed title
            <input value={title} onChange={(event) => title = event.target.value} />
          </label>
          <button type="button" onClick={() => { clicks = clicks + 1; lastAction = `Counter incremented to ${clicks}`; }}>
            Increment atom counter: {clicks}
          </button>
          <p className="derived"><strong>Derived:</strong> {summary}</p>
          <p className="muted">Last action: {lastAction}</p>
        </article>

        <article className="card flow-card">
          <div className="card-heading"><h2>Scope-owned flow</h2></div>
          <p className="flow-value">{state.connection ?? "Connecting…"}</p>
          <p className="muted">The flow progresses once, remains live, and is disposed with its scope.</p>
        </article>

        <article className="card operators-card">
          <div className="card-heading"><h2>Write operators</h2></div>
          <div className="button-row">
            <button type="button" onClick={() => tally += 2}>tally += 2</button>
            <button type="button" onClick={() => tally *= 3}>tally *= 3</button>
            <button type="button" onClick={() => tally++}>tally++</button>
            <button type="button" onClick={() => power **= 2}>power **= 2</button>
            <button type="button" onClick={() => label ||= "Labeled!"}>label ||= "Labeled!"</button>
            <button type="button" onClick={() => nullable ??= 42}>nullable ??= 42</button>
          </div>
          <p className="mono">tally {tally} · power {power} · label {label || "(empty)"} · nullable {nullable ?? "unset"}</p>
          <p className="muted">Compound, update, and logical writes all lower to atom emissions. Explicit read stays reactive: {tally.value}</p>
        </article>

        <article className="card island-card">
          <div className="card-heading"><h2>Component-local ownership</h2></div>
          <div className="button-row">
            <button type="button" onClick={() => islandMounted = !islandMounted}>
              {islandMounted ? "Unmount island" : "Mount island"}
            </button>
          </div>
          {islandMounted ? <LocalIsland /> : <p className="muted">Island unmounted — its atom and scope were disposed with the instance.</p>}
        </article>

        <article className="card alias-card">
          <div className="card-heading"><h2>Aliases, maps, selection</h2></div>
          <div className="button-row">
            <button type="button" onClick={() => clicks = clicks + 5}>clicks + 5 → {alias}</button>
            <button type="button" onClick={() => mappedTally = mappedTally + 1}>mapped tally + 1</button>
            <button type="button" onClick={() => swapped = !swapped}>{swapped.value ? "Show atom" : "Show alias"}</button>
          </div>
          <p className="mono">Alias {alias} · Map {model.title} · Keyed {model[swapped.value ? "tally" : "title"]} · Destructured {mappedTitle}</p>
          <p className="derived"><strong>Selection:</strong> {swapped.value ? alias : title}</p>
        </article>

      </section>

      <output data-testid="preview" aria-live="polite" data-accent={state.accent}>
        {state.enabled ? `${state.name} · ${state.role} — ${title}: ${state.message}` : "Workspace paused"}
      </output>
    </main>
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
