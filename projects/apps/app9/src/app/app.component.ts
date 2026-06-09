import { DecimalPipe, JsonPipe } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { atom, derived, flow, fromPromise, scope, startWith } from '@epikodelabs/streamix';

type Tab = 'tree' | 'state';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DecimalPipe, JsonPipe],
  template: `
    <div class="universe">
      <!-- Animated background mesh -->
      <div class="mesh">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="orb orb-3"></div>
      </div>

      <!-- Header -->
      <header>
        <div class="badge">Reactive Laboratory</div>
        <h1>Atoms &amp; Scopes</h1>
        <p class="subtitle">Watch state flow through the tree in real time</p>
        <div class="completeness-bar">
          <div class="fill" [style.width.%]="completeness.value"></div>
          <span>{{ completeness.value | number:'1.0-0' }}% complete</span>
        </div>
      </header>

      <!-- Main stage -->
      <main class="stage">

        <!-- Left: The Form -->
        <section class="specimen" [style.transform]="'translateX(calc(-' + wizard.step.value + ' * 100% / 3))'">

          <!-- Step 0: Personal -->
          <div class="slide">
            <h2>Identity</h2>
            <div class="field">
              <label [class.lit]="personal.name.value">Codename</label>
              <input
                [value]="personal.name.value"
                (input)="personal.name.set($any($event.target).value)"
                placeholder="Enter codename"
              />
              <div class="pulse-bar" [style.width.%]="personal.name.value.length * 5"></div>
            </div>
            <div class="field">
              <label [class.lit]="personal.email.value">Channel</label>
              <input
                [value]="personal.email.value"
                (input)="personal.email.set($any($event.target).value)"
                placeholder="secure@node.net"
              />
              <div class="pulse-bar" [style.width.%]="personal.email.value.length * 3"></div>
            </div>
          </div>

          <!-- Step 1: Address -->
          <div class="slide">
            <h2>Location</h2>
            <div class="field">
              <label [class.lit]="address.street.value">Sector</label>
              <input
                [value]="address.street.value"
                (input)="address.street.set($any($event.target).value)"
                placeholder="Sector 7-G"
              />
            </div>
            <div class="field">
              <label [class.lit]="address.country.value">Zone</label>
              @if (wizard.async.loading) {
                <div class="loading-pulse">Scanning zones…</div>
              } @else {
                <select
                  [value]="address.country.value"
                  (change)="address.country.set($any($event.target).value)"
                >
                  <option value="">Select zone</option>
                  @for (c of wizard.async.countries.value; track c) {
                    <option [value]="c">{{ c }}</option>
                  }
                </select>
              }
            </div>
          </div>

          <!-- Step 2: Preferences -->
          <div class="slide">
            <h2>Configuration</h2>
            <div class="field row">
              <label class="toggle">
                <input
                  type="checkbox"
                  [checked]="preferences.notifications.value"
                  (change)="preferences.notifications.set($any($event.target).checked)"
                />
                <span class="toggle-glow" [class.on]="preferences.notifications.value"></span>
                <span>Signal beacon</span>
              </label>
            </div>
            <div class="field">
              <label>Interface</label>
              <div class="radio-group">
                @for (opt of ['dark','light','auto']; track opt) {
                  <label class="radio">
                    <input
                      type="radio"
                      name="theme"
                      [value]="opt"
                      [checked]="preferences.theme.value === opt"
                      (change)="preferences.theme.set(opt)"
                    />
                    <span class="radio-glow" [class.on]="preferences.theme.value === opt"></span>
                    <span>{{ opt }}</span>
                  </label>
                }
              </div>
            </div>
          </div>

        </section>
      </main>

      <!-- Right: Debug Sidebar (fixed) -->
      <aside class="sidebar" [class.collapsed]="sidebarCollapsed">
        <div class="sidebar-header">
          <span class="sidebar-title">🔬 Reactive Lab</span>
          <button class="sidebar-toggle" (click)="sidebarCollapsed = !sidebarCollapsed">
            {{ sidebarCollapsed ? '◀' : '▶' }}
          </button>
        </div>

        @if (!sidebarCollapsed) {
          <!-- Tabs -->
          <div class="tabs">
            @for (t of tabs; track t) {
              <button
                [class.active]="activeTab === t"
                (click)="activeTab = t"
              >{{ t }}</button>
            }
          </div>

          <!-- Tree tab -->
          @if (activeTab === 'tree') {
            <div class="tab-panel">
              <div class="tree">
                <div class="node scope-root" [class.loading]="wizard.loading">
                  <span class="dot"></span>
                  <span class="label">wizard</span>
                  <span class="status">{{ wizard.loading ? 'syncing' : 'ready' }}</span>
                </div>
                <div class="branch">
                  <div class="node atom" [class.pulse]="true">
                    <span class="dot"></span>
                    <span class="label">step</span>
                    <span class="value">{{ wizard.step.value }}</span>
                  </div>
                  <div class="node scope" [class.loading]="personal.loading">
                    <span class="dot"></span>
                    <span class="label">personal</span>
                  </div>
                  <div class="branch">
                    <div class="node atom" [class.pulse]="personal.name.value">
                      <span class="dot"></span>
                      <span class="label">name</span>
                      <span class="value truncate">{{ personal.name.value || '—' }}</span>
                    </div>
                    <div class="node atom" [class.pulse]="personal.email.value">
                      <span class="dot"></span>
                      <span class="label">email</span>
                      <span class="value truncate">{{ personal.email.value || '—' }}</span>
                    </div>
                  </div>
                  <div class="node scope" [class.loading]="address.loading">
                    <span class="dot"></span>
                    <span class="label">address</span>
                  </div>
                  <div class="branch">
                    <div class="node atom" [class.pulse]="address.street.value">
                      <span class="dot"></span>
                      <span class="label">street</span>
                      <span class="value truncate">{{ address.street.value || '—' }}</span>
                    </div>
                    <div class="node atom" [class.pulse]="address.country.value">
                      <span class="dot"></span>
                      <span class="label">country</span>
                      <span class="value truncate">{{ address.country.value || '—' }}</span>
                    </div>
                  </div>
                  <div class="node scope" [class.loading]="preferences.loading">
                    <span class="dot"></span>
                    <span class="label">preferences</span>
                  </div>
                  <div class="branch">
                    <div class="node atom" [class.pulse]="preferences.notifications.value">
                      <span class="dot"></span>
                      <span class="label">notifications</span>
                      <span class="value">{{ preferences.notifications.value }}</span>
                    </div>
                    <div class="node atom" [class.pulse]="true">
                      <span class="dot"></span>
                      <span class="label">theme</span>
                      <span class="value">{{ preferences.theme.value }}</span>
                    </div>
                  </div>
                  <div class="node scope" [class.loading]="wizard.async.loading">
                    <span class="dot"></span>
                    <span class="label">async</span>
                  </div>
                  <div class="branch">
                    <div class="node atom" [class.pulse]="!wizard.async.loading">
                      <span class="dot"></span>
                      <span class="label">countries</span>
                      <span class="value">{{ wizard.async.countries.value.length }} zones</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          }

          <!-- State tab -->
          @if (activeTab === 'state') {
            <div class="tab-panel">
              <pre class="snapshot">{{ state.value | json }}</pre>
            </div>
          }
        }
      </aside>

      <!-- Navigation -->
      <footer class="nav">
        <button
          (click)="wizard.step.set(wizard.step.value - 1)"
          [disabled]="wizard.step.value === 0"
        >← Back</button>
        <div class="step-dots">
          @for (_ of [0,1,2]; track $index; let i = $index) {
            <span [class.on]="i === wizard.step.value"></span>
          }
        </div>
        <button
          (click)="wizard.step.set(wizard.step.value + 1)"
          [disabled]="wizard.step.value === 2"
        >Next →</button>
      </footer>

    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: #050508;
      color: #e8eaf0;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      overflow-x: hidden;
    }

    /* ── Animated mesh background ── */
    .universe { position: relative; min-height: 100vh; padding: 32px 324px 80px 24px; }
    @media (max-width: 900px) { .universe { padding-right: 24px; } }
    .mesh { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
    .orb { position: absolute; border-radius: 50%; filter: blur(80px); opacity: .25; animation: float 20s ease-in-out infinite; }
    .orb-1 { width: 600px; height: 600px; background: radial-gradient(circle, #5b8cff 0%, transparent 70%); top: -10%; left: -10%; animation-delay: 0s; }
    .orb-2 { width: 500px; height: 500px; background: radial-gradient(circle, #c084fc 0%, transparent 70%); bottom: -10%; right: -10%; animation-delay: -7s; }
    .orb-3 { width: 400px; height: 400px; background: radial-gradient(circle, #3ddc84 0%, transparent 70%); top: 40%; left: 40%; animation-delay: -14s; }
    @keyframes float { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(30px,-30px) scale(1.1); } 66% { transform: translate(-20px,20px) scale(.95); } }

    /* ── Header ── */
    header { position: relative; z-index: 1; text-align: center; margin-bottom: 32px; max-width: 560px; margin-left: auto; margin-right: auto; }
    .badge { display: inline-block; font-size: .65rem; text-transform: uppercase; letter-spacing: .15em; padding: 4px 12px; border: 1px solid rgba(91,140,255,.3); border-radius: 999px; color: #5b8cff; margin-bottom: 10px; }
    h1 { font-size: 1.6rem; font-weight: 600; margin: 0; letter-spacing: -1px; }
    .subtitle { font-size: .85rem; color: #6b7090; margin: 6px 0 0; font-family: system-ui, sans-serif; }

    /* ── Stage (viewport) ── */
    .stage { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; overflow: hidden; border-radius: 16px; }
    @media (max-width: 900px) { .stage { max-width: 520px; } }

    /* ── Specimen (form) ── */
    .specimen { display: flex; width: 300%; transition: transform .5s cubic-bezier(.4,0,.2,1); will-change: transform; }
    .slide { width: calc(100% / 3); flex-shrink: 0; background: rgba(255,255,255,.03); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,.06); border-radius: 16px; padding: 24px; box-sizing: border-box; }
    .slide h2 { font-size: .9rem; text-transform: uppercase; letter-spacing: .1em; color: #8b92a8; margin: 0 0 16px; }

    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: #6b7090; margin-bottom: 6px; transition: color .3s; }
    .field label.lit { color: #5b8cff; }
    .field input, .field select { width: 100%; background: rgba(0,0,0,.2); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 12px 14px; color: #e8eaf0; font-family: inherit; font-size: .9rem; outline: none; transition: border-color .2s, box-shadow .2s; box-sizing: border-box; }
    .field input:focus, .field select:focus { border-color: rgba(91,140,255,.4); box-shadow: 0 0 0 3px rgba(91,140,255,.08); }
    .pulse-bar { height: 2px; background: linear-gradient(90deg, #5b8cff, #c084fc); border-radius: 2px; margin-top: 4px; transition: width .3s ease; opacity: .6; }
    .loading-pulse { padding: 12px; color: #8b92a8; font-size: .85rem; animation: textPulse 1.5s ease-in-out infinite; }
    @keyframes textPulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }

    .field.row { display: flex; align-items: center; }
    .field .toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; font-family: system-ui, sans-serif; font-size: .85rem; margin-bottom: 0; }
    .field .toggle input { display: none; width: auto; }
    .toggle-glow { width: 36px; height: 20px; background: rgba(255,255,255,.08); border-radius: 10px; position: relative; transition: background .3s; flex-shrink: 0; }
    .toggle-glow::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #8b92a8; border-radius: 50%; transition: transform .3s, background .3s; }
    .toggle-glow.on { background: rgba(61,220,132,.2); }
    .toggle-glow.on::after { transform: translateX(16px); background: #3ddc84; }

    .radio-group { display: flex; gap: 8px; }
    .field .radio { display: flex; align-items: center; gap: 6px; cursor: pointer; font-family: system-ui, sans-serif; font-size: .85rem; padding: 8px 12px; background: rgba(0,0,0,.15); border: 1px solid rgba(255,255,255,.06); border-radius: 8px; margin-bottom: 0; }
    .radio input { display: none; width: auto; }
    .radio-glow { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.15); position: relative; transition: border-color .3s; }
    .radio-glow.on { border-color: #5b8cff; }
    .radio-glow.on::after { content: ''; position: absolute; inset: 2px; background: #5b8cff; border-radius: 50%; }

    /* ── Sidebar (fixed debug panel) ── */
    .sidebar { position: fixed; top: 0; right: 0; bottom: 0; width: 300px; background: rgba(8,8,14,.85); backdrop-filter: blur(16px); border-left: 1px solid rgba(255,255,255,.08); z-index: 20; display: flex; flex-direction: column; transition: width .3s ease; }
    .sidebar.collapsed { width: 44px; }
    @media (max-width: 900px) { .sidebar { display: none; } }

    .sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,.06); flex-shrink: 0; }
    .sidebar-title { font-size: .75rem; font-weight: 600; color: #8b92a8; }
    .sidebar.collapsed .sidebar-title { display: none; }
    .sidebar-toggle { width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.05); color: #8b92a8; font-size: .7rem; cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; }
    .sidebar-toggle:hover { background: rgba(255,255,255,.1); color: #e8eaf0; }

    .tabs { display: flex; gap: 2px; padding: 10px 12px 0; flex-shrink: 0; }
    .tabs button { flex: 1; padding: 6px 0; border-radius: 6px; border: none; background: transparent; color: #6b7090; font-family: inherit; font-size: .65rem; text-transform: uppercase; letter-spacing: .06em; cursor: pointer; transition: all .2s; }
    .tabs button:hover { color: #8b92a8; }
    .tabs button.active { background: rgba(91,140,255,.1); color: #5b8cff; }

    .tab-panel { flex: 1; overflow-y: auto; padding: 12px 16px 16px; min-height: 0; }

    .tree { font-size: .75rem; }
    .branch { margin-left: 16px; padding-left: 12px; border-left: 1px solid rgba(255,255,255,.06); }
    .node { display: flex; align-items: center; gap: 8px; padding: 5px 0; transition: opacity .3s; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,.15); flex-shrink: 0; transition: all .3s; }
    .scope-root .dot { background: #5b8cff; box-shadow: 0 0 8px rgba(91,140,255,.4); }
    .scope .dot { background: rgba(139,146,168,.4); }
    .atom .dot { background: #3ddc84; }
    .node.loading .dot { animation: dotPulse 1s ease-in-out infinite; background: #f5a623; }
    .node.pulse .dot { box-shadow: 0 0 6px currentColor; }
    @keyframes dotPulse { 0%,100% { opacity: .4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.3); } }

    .label { color: #8b92a8; min-width: 80px; }
    .value { color: #5b8cff; margin-left: auto; font-size: .7rem; }
    .truncate { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status { font-size: .65rem; margin-left: auto; color: #6b7090; text-transform: uppercase; }

    .snapshot { margin: 0; font-size: .7rem; color: #8b92a8; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    .log { font-size: .7rem; color: #8b92a8; }
    .log-line { padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,.04); font-family: 'SF Mono', Monaco, 'Courier New', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .log-line:last-child { border-bottom: none; }

    /* ── Footer nav ── */
    .nav { position: fixed; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 20px; padding: 16px; background: linear-gradient(to top, rgba(5,5,8,.9), transparent); z-index: 10; }
    .nav button { padding: 10px 24px; border-radius: 10px; border: 1px solid rgba(91,140,255,.3); background: rgba(91,140,255,.08); color: #5b8cff; font-family: inherit; font-size: .85rem; cursor: pointer; transition: all .2s; }
    .nav button:hover:not(:disabled) { background: rgba(91,140,255,.15); }
    .nav button:disabled { opacity: .3; cursor: not-allowed; }
    .step-dots { display: flex; gap: 6px; }
    .step-dots span { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.15); transition: all .3s; }
    .step-dots span.on { background: #5b8cff; box-shadow: 0 0 6px rgba(91,140,255,.5); transform: scale(1.3); }
  `]
})
export class AppComponent implements OnDestroy {
  readonly cdr = inject(ChangeDetectorRef);

  readonly personal = scope(() => ({
    name: atom(''),
    email: atom(''),
  }));

  readonly address = scope(() => ({
    street: atom(''),
    country: atom(''),
  }));

  readonly preferences = scope(() => ({
    notifications: atom(true),
    theme: atom('dark'),
  }));

  readonly wizard = scope(() => ({
    step: atom(0),
    personal: this.personal,
    address: this.address,
    preferences: this.preferences,
    async: scope(() => ({
      countries: flow(
        fromPromise(() => new Promise<string[]>(r => setTimeout(() => r(['US','CA','UK','DE','FR']), 1500))).pipe(startWith([] as string[]))
      ),
    })),
  }));

  // Derived state
  readonly completeness = derived(() => {
    let score = 0;
    if (this.personal.name.value) score++;
    if (this.personal.email.value) score++;
    if (this.address.street.value) score++;
    if (this.address.country.value) score++;
    return (score / 4) * 100;
  });

  // Single derived snapshot — auto-tracks every atom in the wizard tree
  readonly state = derived(() => ({
    ...this.wizard.snapshot(),
    completeness: this.completeness.value,
  }));

  sidebarCollapsed = false;
  activeTab: Tab = 'tree';
  readonly tabs: Tab[] = ['tree', 'state'];

  constructor() {
    // Async atoms update outside Angular's zone — trigger CD manually
    this.state.subscribe(() => this.cdr.detectChanges());
  }

  ngOnDestroy() {
    this.state.dispose();
    this.completeness.dispose();
    this.wizard.dispose();
  }
}
