import { atom, derived, flow, from, pipe, scope, startWith } from '@epikodelabs/streamix';
import { ReactiveRenderer } from './renderer';

type Tab = 'tree' | 'state';

const template = `
<div class="universe">
  <div class="mesh">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
  </div>

  <header>
    <div class="badge">Reactive Laboratory</div>
    <h1>Atoms &amp; Scopes</h1>
    <p class="subtitle">Watch state flow through the tree in real time</p>
    <div class="completeness-bar">
      <div class="fill" [style.width.%]="Math.round(completeness.value)"></div>
      <span>{{ Math.round(completeness.value) }}% complete</span>
    </div>
  </header>

  <main class="stage">
    <section class="specimen" [style.transform]="'translateX(calc(-' + wizard.step.value + ' * 100% / 3))'">

      <div class="slide">
        <h2>Identity</h2>
        <div class="field">
          <label [class.lit]="personal.name.value">Codename</label>
          <input model="personal.name" placeholder="Enter codename" />
          <div class="pulse-bar" [style.width.%]="personal.name.value.length * 5"></div>
        </div>
        <div class="field">
          <label [class.lit]="personal.email.value">Channel</label>
          <input model="personal.email" placeholder="secure@node.net" />
          <div class="pulse-bar" [style.width.%]="personal.email.value.length * 3"></div>
        </div>
      </div>

      <div class="slide">
        <h2>Location</h2>
        <div class="field">
          <label [class.lit]="address.street.value">Sector</label>
          <input model="address.street" placeholder="Sector 7-G" />
        </div>
        <div class="field">
          <label [class.lit]="address.country.value">Zone</label>
          <div if="asyncLoading.value" class="loading-pulse">Scanning zones…</div>
          <select if="!asyncLoading.value" model="address.country">
            <option value="">Select zone</option>
            <template for="c of countriesList">
              <option value="{{ c }}">{{ c }}</option>
            </template>
          </select>
        </div>
      </div>

      <div class="slide">
        <h2>Configuration</h2>
        <div class="field row">
          <label class="toggle">
            <input type="checkbox" model="preferences.notifications" />
            <span class="toggle-glow" [class.on]="preferences.notifications.value"></span>
            <span>Signal beacon</span>
          </label>
        </div>
        <div class="field">
          <label>Interface</label>
          <div class="radio-group">
            <label class="radio">
              <input type="radio" name="theme" value="dark" model="preferences.theme" />
              <span class="radio-glow" [class.on]="preferences.theme.value === 'dark'"></span>
              <span>dark</span>
            </label>
            <label class="radio">
              <input type="radio" name="theme" value="light" model="preferences.theme" />
              <span class="radio-glow" [class.on]="preferences.theme.value === 'light'"></span>
              <span>light</span>
            </label>
            <label class="radio">
              <input type="radio" name="theme" value="auto" model="preferences.theme" />
              <span class="radio-glow" [class.on]="preferences.theme.value === 'auto'"></span>
              <span>auto</span>
            </label>
          </div>
        </div>
      </div>

    </section>
  </main>

  <aside class="sidebar" [class.collapsed]="sidebarCollapsed.value">
    <div class="sidebar-header">
      <span class="sidebar-title">🔬 Reactive Lab</span>
      <button class="sidebar-toggle" (click)="toggleSidebar">{{ sidebarCollapsed.value ? '◀' : '▶' }}</button>
    </div>
    <div class="tabs">
      <button [class.active]="activeTab.value === 'tree'" (click)="setTabTree">tree</button>
      <button [class.active]="activeTab.value === 'state'" (click)="setTabState">state</button>
    </div>
    <div class="tab-panel">

      <div if="activeTab.value === 'tree'">
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
              <span class="value">{{ wizard.step.value }}</span>
            </div>
            <div class="node scope" [class.loading]="personalLoading.value">
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
            <div class="node scope" [class.loading]="addressLoading.value">
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
            <div class="node scope" [class.loading]="preferencesLoading.value">
              <span class="dot"></span>
              <span class="label">preferences</span>
            </div>
            <div class="branch">
              <div class="node atom" [class.pulse]="preferences.notifications.value">
                <span class="dot"></span>
                <span class="label">notifications</span>
                <span class="value">{{ preferences.notifications.value }}</span>
              </div>
              <div class="node atom pulse">
                <span class="dot"></span>
                <span class="label">theme</span>
                <span class="value">{{ preferences.theme.value }}</span>
              </div>
            </div>
            <div class="node scope" [class.loading]="asyncLoading.value">
              <span class="dot"></span>
              <span class="label">async</span>
            </div>
            <div class="branch">
              <div class="node atom" [class.pulse]="!asyncLoading.value">
                <span class="dot"></span>
                <span class="label">countries</span>
                <span class="value">{{ countriesList.value.length }} zones</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div if="activeTab.value === 'state'">
        <pre class="snapshot">{{ JSON.stringify(state.value, null, 2) }}</pre>
      </div>

    </div>
  </aside>

  <footer class="nav">
    <button (click)="goBack" [disabled]="wizard.step.value === 0">← Back</button>
    <div class="step-dots">
      <span [class.on]="wizard.step.value === 0"></span>
      <span [class.on]="wizard.step.value === 1"></span>
      <span [class.on]="wizard.step.value === 2"></span>
    </div>
    <button (click)="goNext" [disabled]="wizard.step.value === 2">Next →</button>
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
                countries: flow<string[]>(pipe(
                    from(() => new Promise<string[]>(r => setTimeout(() => r(['US', 'CA', 'UK', 'DE', 'FR']), 1500))),
                    startWith([] as string[])
                )),
            })),
        }));

        const completeness = derived(() => {
            let score = 0;
            if (personal.name.value) score++;
            if (personal.email.value) score++;
            if (address.street.value) score++;
            if (address.country.value) score++;
            return (score / 4) * 100;
        });

        const state = derived(() => ({
            ...wizard.snapshot(),
            completeness: completeness.value,
        }));

        const activeTab = atom<Tab>('tree');
        const sidebarCollapsed = atom(false);

        const wizardLoading = derived(() => { wizard.snapshot(); return wizard.loading; });
        const personalLoading = derived(() => { personal.snapshot(); return personal.loading; });
        const addressLoading = derived(() => { address.snapshot(); return address.loading; });
        const preferencesLoading = derived(() => { preferences.snapshot(); return preferences.loading; });
        const asyncLoading = derived(() => { wizard.async.snapshot(); return wizard.async.loading; });
        const countriesList = derived(() => wizard.async.countries.value ?? []);

        return {
            personal, address, preferences, wizard,
            completeness, state, activeTab, sidebarCollapsed,
            wizardLoading, personalLoading, addressLoading, preferencesLoading, asyncLoading, countriesList,
            Math, JSON,
            goBack: () => wizard.step.next(Math.max(0, wizard.step.value - 1)),
            goNext: () => wizard.step.next(Math.min(2, wizard.step.value + 1)),
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
