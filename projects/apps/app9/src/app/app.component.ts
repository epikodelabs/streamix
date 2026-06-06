import { JsonPipe } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { Subscription, promiseAtom, scope, writableAtom } from '@epikodelabs/streamix';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [JsonPipe],
  template: `
    <div class="app">
      <header class="header">
        <h1>🧪 Atoms &amp; Scopes</h1>
        <p class="subtitle">Multi-step wizard demo — reactive state with tree loading</p>
      </header>

      <div class="layout">
        <!-- Main wizard panel -->
        <main class="wizard">
          <!-- Step indicator -->
          <nav class="steps">
            @for (name of stepNames; track $index; let i = $index) {
              <div class="step" [class.active]="i === wizardScope.step.value" [class.done]="i < wizardScope.step.value">
                <span class="step-number">{{ i + 1 }}</span>
                <span class="step-name">{{ name }}</span>
                @if (stepLoading[i]) {
                  <span class="step-spinner"></span>
                }
              </div>
            }
          </nav>

          <!-- Wizard loading overlay -->
          @if (wizardLoading) {
            <div class="wizard-loading">
              <div class="spinner"></div>
              <span>Wizard initializing…</span>
            </div>
          }

          <!-- Step 1: Personal -->
          @if (wizardScope.step.value === 0) {
            <section class="step-panel">
              <h2>Personal Information</h2>
              <div class="field">
                <label>Full Name</label>
                <input
                  type="text"
                  [value]="personalScope.name.value"
                  (input)="personalScope.name.set($any($event.target).value); cdr.detectChanges()"
                  placeholder="Enter your name"
                />
                @if (!personalScope.name.value) {
                  <span class="hint">Required</span>
                }
              </div>
              <div class="field">
                <label>Email</label>
                <input
                  type="email"
                  [value]="personalScope.email.value"
                  (input)="personalScope.email.set($any($event.target).value); cdr.detectChanges()"
                  placeholder="you@example.com"
                />
                @if (!personalScope.email.value) {
                  <span class="hint">Required</span>
                }
              </div>
            </section>
          }

          <!-- Step 2: Address -->
          @if (wizardScope.step.value === 1) {
            <section class="step-panel">
              <h2>Address</h2>
              @if (addressLoading) {
                <div class="panel-loading">
                  <div class="spinner small"></div>
                  <span>Loading country list…</span>
                </div>
              }
              <div class="field">
                <label>Street</label>
                <input
                  type="text"
                  [value]="addressScope.street.value"
                  (input)="addressScope.street.set($any($event.target).value); cdr.detectChanges()"
                  placeholder="123 Main St"
                />
              </div>
              <div class="field">
                <label>City</label>
                <input
                  type="text"
                  [value]="addressScope.city.value"
                  (input)="addressScope.city.set($any($event.target).value); cdr.detectChanges()"
                  placeholder="New York"
                />
              </div>
              <div class="field">
                <label>Country</label>
                <select
                  [value]="addressScope.country.value"
                  (change)="addressScope.country.set($any($event.target).value); cdr.detectChanges()"
                >
                  <option value="">Select a country</option>
                  @for (c of wizardScope.async.countries.value; track c) {
                    <option [value]="c">{{ c }}</option>
                  }
                </select>
                @if (wizardScope.async.countries.value.length === 0) {
                  <span class="hint">Loading countries…</span>
                }
              </div>
            </section>
          }

          <!-- Step 3: Preferences -->
          @if (wizardScope.step.value === 2) {
            <section class="step-panel">
              <h2>Preferences</h2>
              <div class="field row">
                <label class="toggle">
                  <input
                    type="checkbox"
                    [checked]="preferencesScope.notifications.value"
                    (change)="preferencesScope.notifications.set($any($event.target).checked); cdr.detectChanges()"
                  />
                  <span class="toggle-slider"></span>
                  <span>Enable notifications</span>
                </label>
              </div>
              <div class="field">
                <label>Theme</label>
                <div class="radio-group">
                  <label class="radio">
                    <input
                      type="radio"
                      name="theme"
                      value="dark"
                      [checked]="preferencesScope.theme.value === 'dark'"
                      (change)="preferencesScope.theme.set('dark'); cdr.detectChanges()"
                    />
                    <span>Dark</span>
                  </label>
                  <label class="radio">
                    <input
                      type="radio"
                      name="theme"
                      value="light"
                      [checked]="preferencesScope.theme.value === 'light'"
                      (change)="preferencesScope.theme.set('light'); cdr.detectChanges()"
                    />
                    <span>Light</span>
                  </label>
                  <label class="radio">
                    <input
                      type="radio"
                      name="theme"
                      value="auto"
                      [checked]="preferencesScope.theme.value === 'auto'"
                      (change)="preferencesScope.theme.set('auto'); cdr.detectChanges()"
                    />
                    <span>Auto</span>
                  </label>
                </div>
              </div>
            </section>
          }

          <!-- Navigation -->
          <div class="nav">
            <button
              class="btn secondary"
              (click)="goBack()"
              [disabled]="wizardScope.step.value === 0"
            >Back</button>

            @if (wizardScope.step.value < totalSteps - 1) {
              <button
                class="btn primary"
                (click)="goNext()"
                [disabled]="!canAdvance()"
              >Next</button>
            } @else {
              <button
                class="btn primary"
                (click)="submit()"
                [disabled]="!canSubmit()"
              >Submit</button>
            }
          </div>

          <!-- Submission result -->
          @if (submitted) {
            <div class="success-banner">
              ✅ Form submitted! Check the snapshot panel for the captured state tree.
            </div>
          }
        </main>

        <!-- Sidebar: state inspector -->
        <aside class="inspector">
          <div class="inspector-card">
            <h3>🔍 State Inspector</h3>

            <div class="inspector-section">
              <h4>Wizard Loading</h4>
              <div class="loading-bar">
                <div class="loading-fill" [style.width.%]="wizardLoading ? 30 : 100"></div>
              </div>
              <span class="loading-label">{{ wizardLoading ? 'Loading…' : 'Ready' }}</span>
            </div>

            <div class="inspector-section">
              <h4>Step Loading</h4>
              @for (name of stepNames; track $index; let i = $index) {
                <div class="loading-row">
                  <span>{{ name }}</span>
                  <span [class]="stepLoading[i] ? 'status-loading' : 'status-ready'">
                    {{ stepLoading[i] ? 'loading' : 'ready' }}
                  </span>
                </div>
              }
            </div>

            <div class="inspector-section">
              <h4>Live Snapshot</h4>
              <pre class="snapshot">{{ snapshotJson }}</pre>
            </div>

            <div class="inspector-section">
              <h4>Atom Values</h4>
              <div class="atom-row"><span>name</span><code>{{ personalScope.name.value | json }}</code></div>
              <div class="atom-row"><span>email</span><code>{{ personalScope.email.value | json }}</code></div>
              <div class="atom-row"><span>street</span><code>{{ addressScope.street.value | json }}</code></div>
              <div class="atom-row"><span>city</span><code>{{ addressScope.city.value | json }}</code></div>
              <div class="atom-row"><span>country</span><code>{{ addressScope.country.value | json }}</code></div>
              <div class="atom-row"><span>notifications</span><code>{{ preferencesScope.notifications.value | json }}</code></div>
              <div class="atom-row"><span>theme</span><code>{{ preferencesScope.theme.value | json }}</code></div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `,
  styles: [`
    :host {
      --bg: #0f1117;
      --surface: #181b24;
      --surface-hover: #1e2230;
      --border: #2a2f3f;
      --text: #e2e5ec;
      --text-muted: #8b92a8;
      --accent: #5b8cff;
      --accent-hover: #4a7aee;
      --success: #3ddc84;
      --warning: #f5a623;
      --error: #ff5f5f;
      --radius: 12px;
      display: block;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .app { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }

    .header { text-align: center; margin-bottom: 28px; }
    .header h1 { font-size: 2rem; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.5px; }
    .subtitle { color: var(--text-muted); font-size: 0.95rem; margin: 0; }

    .layout {
      display: grid;
      grid-template-columns: 1fr 360px;
      gap: 24px;
      align-items: start;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
    }

    .wizard {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .steps {
      display: flex;
      gap: 8px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .step {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: 999px;
      background: var(--bg);
      border: 1px solid var(--border);
      font-size: 0.85rem;
      transition: all 0.2s;
    }
    .step.active { border-color: var(--accent); background: rgba(91,140,255,0.12); }
    .step.done { border-color: var(--success); background: rgba(61,220,132,0.1); }
    .step-number {
      width: 22px; height: 22px;
      border-radius: 50%;
      background: var(--border);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.75rem; font-weight: 600;
    }
    .step.active .step-number { background: var(--accent); color: #fff; }
    .step.done .step-number { background: var(--success); color: #000; }

    .step-spinner {
      width: 14px; height: 14px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .wizard-loading {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding: 40px; color: var(--text-muted); font-size: 0.9rem;
    }
    .spinner {
      width: 36px; height: 36px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .spinner.small { width: 20px; height: 20px; border-width: 2px; }

    .step-panel {
      display: flex; flex-direction: column; gap: 16px;
    }
    .step-panel h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }

    .panel-loading {
      display: flex; align-items: center; gap: 10px;
      padding: 16px; background: var(--bg); border-radius: 8px;
      color: var(--text-muted); font-size: 0.85rem;
    }

    .field {
      display: flex; flex-direction: column; gap: 6px;
    }
    .field.row { flex-direction: row; align-items: center; gap: 10px; }
    .field label { font-size: 0.85rem; color: var(--text-muted); font-weight: 500; }
    .field input[type="text"], .field input[type="email"], .field select {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
    }
    .field input:focus, .field select:focus { border-color: var(--accent); }
    .field select { cursor: pointer; }
    .hint { font-size: 0.75rem; color: var(--warning); }

    .toggle {
      display: flex; align-items: center; gap: 10px;
      cursor: pointer; font-size: 0.9rem;
    }
    .toggle input { display: none; }
    .toggle-slider {
      width: 40px; height: 22px;
      background: var(--border);
      border-radius: 11px;
      position: relative;
      transition: background 0.2s;
    }
    .toggle-slider::after {
      content: '';
      position: absolute;
      top: 2px; left: 2px;
      width: 18px; height: 18px;
      background: #fff;
      border-radius: 50%;
      transition: transform 0.2s;
    }
    .toggle input:checked + .toggle-slider { background: var(--accent); }
    .toggle input:checked + .toggle-slider::after { transform: translateX(18px); }

    .radio-group { display: flex; gap: 12px; flex-wrap: wrap; }
    .radio {
      display: flex; align-items: center; gap: 6px;
      cursor: pointer; font-size: 0.9rem;
      padding: 8px 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .radio input { accent-color: var(--accent); }

    .nav {
      display: flex; justify-content: space-between; gap: 12px;
      padding-top: 12px; border-top: 1px solid var(--border);
    }
    .btn {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn.primary { background: var(--accent); color: #fff; }
    .btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn.secondary { background: var(--bg); color: var(--text); border: 1px solid var(--border); }
    .btn.secondary:hover:not(:disabled) { border-color: var(--accent); }

    .success-banner {
      padding: 14px 18px;
      background: rgba(61,220,132,0.1);
      border: 1px solid rgba(61,220,132,0.3);
      border-radius: 8px;
      color: var(--success);
      font-size: 0.9rem;
    }

    .inspector {}
    .inspector-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      position: sticky;
      top: 24px;
    }
    .inspector-card h3 { margin: 0; font-size: 1rem; font-weight: 600; }

    .inspector-section {}
    .inspector-section h4 { margin: 0 0 10px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }

    .loading-bar {
      height: 6px;
      background: var(--bg);
      border-radius: 3px;
      overflow: hidden;
    }
    .loading-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .loading-label { font-size: 0.8rem; color: var(--text-muted); margin-top: 6px; display: block; }

    .loading-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid rgba(42,47,63,0.5);
      font-size: 0.85rem;
    }
    .loading-row:last-child { border-bottom: none; }
    .status-loading { color: var(--warning); font-size: 0.75rem; }
    .status-ready { color: var(--success); font-size: 0.75rem; }

    .snapshot {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-size: 0.75rem;
      font-family: 'Courier New', monospace;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text-muted);
      max-height: 240px;
      overflow-y: auto;
    }

    .atom-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 5px 0;
      border-bottom: 1px solid rgba(42,47,63,0.3);
      font-size: 0.8rem;
    }
    .atom-row:last-child { border-bottom: none; }
    .atom-row code {
      background: var(--bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.75rem;
      color: var(--accent);
    }
  `]
})
export class AppComponent implements OnDestroy {
  readonly cdr = inject(ChangeDetectorRef);

  // Simulated async fetch for country list (resolves after 1.5s)
  private loadCountries = () =>
    new Promise<string[]>(resolve =>
      setTimeout(() =>
        resolve(['United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Japan', 'Australia']),
        1500
      )
    );

  // Scopes — initialized at declaration so TypeScript infers types.
  readonly personalScope = scope(() => ({
    name: writableAtom(''),
    email: writableAtom(''),
  }));

  readonly addressScope = scope(() => ({
    street: writableAtom(''),
    city: writableAtom(''),
    country: writableAtom(''),
  }));

  readonly preferencesScope = scope(() => ({
    notifications: writableAtom(true),
    theme: writableAtom('dark'),
  }));

  readonly wizardScope = scope(() => ({
    step: writableAtom(0),
    personal: this.personalScope,
    address: this.addressScope,
    preferences: this.preferencesScope,
    async: scope(() => ({
      countries: promiseAtom(this.loadCountries, [] as string[]),
    })),
  }));

  // UI state
  totalSteps = 3;
  stepNames = ['Personal', 'Address', 'Preferences'];
  snapshotJson = '{}';
  wizardLoading = true;
  addressLoading = true;
  stepLoading = [false, true, false];
  submitted = false;

  private subscriptions: Subscription[] = [];

  constructor() {
    // Only async data needs a subscription — when the promise resolves
    // no user event triggers change detection, so we watch the atom.
    this.subscriptions.push(
      this.wizardScope.async.countries.subscribe(() => this.cdr.detectChanges())
    );

    this.startLoadingPoller();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
    this.wizardScope.dispose();
  }

  /**
   * Polls scope loading state and snapshot so the inspector stays live.
   * In a real app this would be driven by atom subscriptions; here we
   * poll for simplicity to show the tree-level loading behaviour.
   */
  private startLoadingPoller(): void {
    const tick = () => {
      const asyncLoading = this.wizardScope.async.loading;
      this.wizardLoading = asyncLoading;
      this.addressLoading = asyncLoading;
      this.stepLoading = [false, asyncLoading, false];
      this.snapshotJson = JSON.stringify(this.wizardScope.snapshot(), null, 2);
      this.cdr.detectChanges();
    };

    // Poll every 100 ms for smooth loading indicator updates
    const intervalId = setInterval(tick, 100);

    // Stop polling after 5 seconds when everything should be loaded
    setTimeout(() => clearInterval(intervalId), 5000);
  }

  goBack(): void {
    this.wizardScope.step.set(this.wizardScope.step.value - 1);
    this.cdr.detectChanges();
  }

  goNext(): void {
    this.wizardScope.step.set(this.wizardScope.step.value + 1);
    this.cdr.detectChanges();
  }

  canAdvance(): boolean {
    const step = this.wizardScope.step.value;
    if (step === 0) {
      return !!this.personalScope.name.value && !!this.personalScope.email.value;
    }
    if (step === 1) {
      return !!this.addressScope.street.value && !!this.addressScope.city.value && !!this.addressScope.country.value;
    }
    return true;
  }

  canSubmit(): boolean {
    return this.canAdvance() && this.wizardScope.step.value === this.totalSteps - 1;
  }

  submit(): void {
    this.submitted = true;
    console.log('Wizard snapshot:', this.wizardScope.snapshot());
    this.cdr.detectChanges();
  }
}
