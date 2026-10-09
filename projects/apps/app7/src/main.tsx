// @ts-nocheck -- compiled by @epikodelabs/streamix/react/builder before TypeScript checks JSX.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { atom, derived, flow, scope } from "@epikodelabs/streamix";

// A standalone atom: a compiler lowers `value={title}` through atomBinding().
let title = atom("Native atom property");
let clicks = atom(0);
let lastAction = atom("Waiting for input");
const summary = derived($ => `${$(title)} · ${$(clicks)} actions`);

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

function App() {
  return (
    <main className="demo">
      <header className="hero">
        <p className="eyebrow">Streamix × React</p>
        <span className="status">{state.connection ?? "Connecting…"}</span>
      </header>
      <h1>Direct atom JSX laboratory</h1>
      <p className="copy">
        A comprehensive compiler sample: standalone atoms, scope fields,
        derived values, and scope-owned flows are all used directly in TSX.
      </p>

      <section className="dashboard">
        <article className="card profile-card">
          <div className="card-heading"><span>01</span><h2>Scoped profile</h2></div>
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
          <div className="card-heading"><span>02</span><h2>Standalone atoms</h2></div>
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
          <div className="card-heading"><span>03</span><h2>Scope-owned flow</h2></div>
          <p className="flow-value">{state.connection ?? "Connecting…"}</p>
          <p className="muted">The flow progresses once, remains live, and is disposed with its scope.</p>
        </article>
      </section>

      <section className="diagnostics" aria-label="Reactive diagnostics">
        <div><span>Scope flow</span><strong>{state.connection ?? "Connecting…"}</strong></div>
        <div><span>Scope mode</span><strong>{state.enabled ? "Enabled" : "Paused"}</strong></div>
        <div><span>Derived title</span><strong>{summary}</strong></div>
        <div><span>Preferences</span><strong>{state.notifications ? "Notifications on" : "Notifications off"}</strong></div>
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
