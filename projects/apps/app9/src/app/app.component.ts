import { atom, derived, flow, scope } from '@epikodelabs/streamix';
import { ReactiveRenderer } from './renderer';

type Tab = 'tree' | 'state';

const template = `
<div class="universe">
  <div class="mesh">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
  </div>

  <div class="toast-container">
    <div if="toast" class="toast">{{ toast }}</div>
  </div>

  <header>
    <div class="badge">Reactive Laboratory</div>
    <h1>Atoms &amp; Scopes</h1>
    <p class="subtitle">Watch state flow through the tree in real time</p>
    <div class="completeness-bar">
      <div class="fill" [style.width.%]="Math.round(completeness)"></div>
      <span>{{ Math.round(completeness) }}% complete</span>
    </div>
  </header>

  <main class="stage">
    <section class="specimen" [style.transform]="'translateX(calc(-' + wizard.step + ' * 100% / 3))'">

      <div class="slide">
        <h2>Identity</h2>
        <div class="field">
          <label [class.lit]="personal.name">Codename</label>
          <input model="personal.name" placeholder="Enter codename" />
          <div class="pulse-bar" [style.width.%]="personal.name.length * 5"></div>
        </div>
        <div class="field">
          <label [class.lit]="personal.email">Channel</label>
          <input model="personal.email" placeholder="secure@node.net" />
          <div class="pulse-bar" [style.width.%]="personal.email.length * 3"></div>
        </div>
      </div>

      <div class="slide">
        <h2>Location</h2>
        <div class="field">
          <label [class.lit]="address.street">Sector</label>
          <input model="address.street" placeholder="Sector 7-G" />
        </div>
        <div class="field">
          <label [class.lit]="address.country">Zone</label>
          <div if="countriesList.length === 0" class="loading-pulse">Scanning zones…</div>
          <select if="countriesList.length > 0" bind-innerhtml="countryOptions" model="address.country"></select>
        </div>
      </div>

      <div class="slide">
        <h2>Configuration</h2>
        <div class="field row">
          <label class="toggle">
            <input type="checkbox" model="preferences.notifications" />
            <span class="toggle-glow" [class.on]="preferences.notifications"></span>
            <span>Signal beacon</span>
          </label>
        </div>
        <div class="field">
          <label>Interface</label>
          <div class="radio-group">
            <label class="radio">
              <input type="radio" name="theme" value="dark" model="preferences.theme" />
              <span class="radio-glow" [class.on]="preferences.theme === 'dark'"></span>
              <span>dark</span>
            </label>
            <label class="radio">
              <input type="radio" name="theme" value="light" model="preferences.theme" />
              <span class="radio-glow" [class.on]="preferences.theme === 'light'"></span>
              <span>light</span>
            </label>
            <label class="radio">
              <input type="radio" name="theme" value="auto" model="preferences.theme" />
              <span class="radio-glow" [class.on]="preferences.theme === 'auto'"></span>
              <span>auto</span>
            </label>
          </div>
        </div>
      </div>

    </section>
  </main>

  <aside class="sidebar" [class.collapsed]="sidebarCollapsed">
    <div class="sidebar-header">
      <span class="sidebar-title">🔬 Reactive Lab</span>
      <button class="sidebar-toggle" (click)="toggleSidebar">{{ sidebarCollapsed ? '◀' : '▶' }}</button>
    </div>
    <div class="tabs">
      <button [class.active]="activeTab === 'tree'" (click)="setTabTree">tree</button>
      <button [class.active]="activeTab === 'state'" (click)="setTabState">state</button>
    </div>
    <div class="tab-panel">

      <div if="activeTab === 'tree'">
        <div class="tree">
          <div class="node scope-root" [class.loading]="wizard.loading">
            <span class="dot"></span>
            <span class="label">wizard</span>
            <span class="status">{{ wizard.loading ? 'syncing' : 'ready' }}</span>
          </div>
          <div class="branch">
            <div class="node atom">
              <span class="dot"></span>
              <span class="label">step</span>
              <span class="value">{{ wizard.step }}</span>
            </div>
            <div class="node scope" [class.loading]="personal.loading">
              <span class="dot"></span>
              <span class="label">personal</span>
            </div>
            <div class="branch">
              <div class="node atom" [class.pulse]="personal.name">
                <span class="dot"></span>
                <span class="label">name</span>
                <span class="value truncate">{{ personal.name || '—' }}</span>
              </div>
              <div class="node atom" [class.pulse]="personal.email">
                <span class="dot"></span>
                <span class="label">email</span>
                <span class="value truncate">{{ personal.email || '—' }}</span>
              </div>
            </div>
            <div class="node scope" [class.loading]="address.loading">
              <span class="dot"></span>
              <span class="label">address</span>
            </div>
            <div class="branch">
              <div class="node atom" [class.pulse]="address.street">
                <span class="dot"></span>
                <span class="label">street</span>
                <span class="value truncate">{{ address.street || '—' }}</span>
              </div>
              <div class="node atom" [class.pulse]="address.country">
                <span class="dot"></span>
                <span class="label">country</span>
                <span class="value truncate">{{ address.country || '—' }}</span>
              </div>
            </div>
            <div class="node scope" [class.loading]="preferences.loading">
              <span class="dot"></span>
              <span class="label">preferences</span>
            </div>
            <div class="branch">
              <div class="node atom" [class.pulse]="preferences.notifications">
                <span class="dot"></span>
                <span class="label">notifications</span>
                <span class="value">{{ preferences.notifications }}</span>
              </div>
              <div class="node atom pulse">
                <span class="dot"></span>
                <span class="label">theme</span>
                <span class="value">{{ preferences.theme }}</span>
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
                <span class="value">{{ countriesList.length }} zones</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div if="activeTab === 'state'">
        <pre class="snapshot">{{ JSON.stringify(state, null, 2) }}</pre>
      </div>

    </div>
  </aside>

  <footer class="nav">
    <button (click)="goBack" [disabled]="wizard.step === 0">← Back</button>
    <div class="step-dots">
      <span [class.on]="wizard.step === 0"></span>
      <span [class.on]="wizard.step === 1"></span>
      <span [class.on]="wizard.step === 2"></span>
    </div>
    <button if="wizard.step === 2" (click)="submit">Submit</button>
    <button if="wizard.step !== 2" (click)="goNext" [disabled]="wizard.step === 2">Next →</button>
  </footer>
</div>
`;

export function mountApp(root: HTMLElement): () => void {
    const app = scope(() => {
        const personal = scope(() => ({
            name: atom(''),
            email: atom(''),
        }));

        const address = scope(() => ({
            street: atom(''),
            country: atom(''),
        }));

        const preferences = scope(() => ({
            notifications: atom(true),
            theme: atom('dark'),
        }));

        const wizard = scope(() => ({
            step: atom(0),
            personal,
            address,
            preferences,
            async: scope(() => ({
                countries: flow((async function* () {
                    yield [] as string[];
                    await new Promise(r => setTimeout(r, 1500));
                    yield ['US', 'CA', 'UK', 'DE', 'FR'];
                })()),
            })),
        }));

        const completeness = derived(() => {
            let score = 0;
            if (personal.name) score++;
            if (personal.email) score++;
            if (address.street) score++;
            if (address.country) score++;
            return (score / 4) * 100;
        });

        const state = derived(() => ({
            ...wizard.snapshot(),
            completeness: completeness.value,
        }));

        const activeTab = atom<Tab>('tree');
        const sidebarCollapsed = atom(false);
        const toast = atom<string | null>(null);


        const countriesList = derived(() => wizard.async.countries ?? []);
        const countryOptions = derived(() =>
            '<option value="">Select zone</option>' +
            countriesList.value.map((c: string) => `<option value="${c}">${c}</option>`).join('')
        );

        const submit = () => {
            if (completeness.value === 100) {
                toast.next('Profile synchronized successfully');
            } else {
                toast.next(`Complete all fields first (${Math.round(completeness.value)}%)`);
            }
            setTimeout(() => toast.next(null), 3000);
        };

        return {
            personal, address, preferences, wizard,
            completeness, state, activeTab, sidebarCollapsed, toast,
            countriesList, countryOptions,
            Math, JSON,
            goBack: () => wizard.step = Math.max(0, wizard.step - 1),
            goNext: () => wizard.step = Math.min(2, wizard.step + 1),
            submit,
            toggleSidebar: () => sidebarCollapsed.next(!sidebarCollapsed.value),
            setTabTree: () => activeTab.next('tree'),
            setTabState: () => activeTab.next('state'),
        };
    });

    const renderer = new ReactiveRenderer();
    renderer.render(template, app, root);

    return () => {
        renderer.destroy();
        app.dispose();
    };
}
