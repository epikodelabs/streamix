import { Component, OnDestroy, OnInit } from '@angular/core';
import { scope } from '@epikodelabs/streamix';

interface AppModel {
    step: number;
    name: string;
    email: string;
    street: string;
    country: string;
    notifications: boolean;
    theme: string;
    activeTab: string;
    sidebarCollapsed: boolean;
    toast: string | null;
    zonesLoading: boolean;
    zonesReady: boolean;
    selectDisplay: string;
    countries: string[];
    nameDisplay: string;
    emailDisplay: string;
    streetDisplay: string;
    countryDisplay: string;
    completeness: number;
    completenessText: string;
    completenessLabel: string;
    completenessSyncedLabel: string;
    completenessWidth: string;
    stageTransform: string;
    namePulse: string;
    emailPulse: string;
    sidebarArrow: string;
    zonesLabel: string;
    snapshotText: string;
}

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [],
    template: `
    <div class="universe">
      <div class="mesh">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="orb orb-3"></div>
      </div>

      <div class="toast-container">
        @if (model.toast) {
          <div class="toast">{{ model.toast }}</div>
        }
      </div>

      <header>
        <div class="badge">Reactive Laboratory</div>
        <h1>Atoms &amp; Scopes</h1>
        <p class="subtitle">Watch state flow through the tree in real time</p>
        <div class="completeness-bar">
          <div class="fill" [style.width]="model.completenessWidth"></div>
          <span>{{ model.completenessLabel }}</span>
        </div>
      </header>

      <main class="stage">
        <section class="specimen" [style.transform]="model.stageTransform">

          <div class="slide">
            <h2>Identity</h2>
            <div class="field">
              <label [class.lit]="model.name">Codename</label>
              <input [(value)]="model.name" placeholder="Enter codename" />
              <div class="pulse-bar" [style.width]="model.namePulse"></div>
            </div>
            <div class="field">
              <label [class.lit]="model.email">Channel</label>
              <input [(value)]="model.email" placeholder="secure@node.net" />
              <div class="pulse-bar" [style.width]="model.emailPulse"></div>
            </div>
          </div>

          <div class="slide">
            <h2>Location</h2>
            <div class="field">
              <label [class.lit]="model.street">Sector</label>
              <input [(value)]="model.street" placeholder="Sector 7-G" />
            </div>
            <div class="field">
              <label [class.lit]="model.country">Zone</label>
              @if (model.zonesLoading) {
                <div class="loading-pulse">Scanning zones…</div>
              }
              <select [(value)]="model.country" [style.display]="model.selectDisplay">
                <option value="">Select zone</option>
                @for (c of model.countries; track c) {
                  <option [value]="c">{{ c }}</option>
                }
              </select>
            </div>
          </div>

          <div class="slide">
            <h2>Configuration</h2>
            <div class="field row">
              <label class="toggle">
                <input type="checkbox" [(checked)]="model.notifications" />
                <span class="toggle-glow" [class.on]="model.notifications"></span>
                <span>Signal beacon</span>
              </label>
            </div>
            <div class="field">
              <label>Interface</label>
              <div class="radio-group">
                <label class="radio">
                  <input type="radio" name="theme" value="dark" [checked]="model.theme === 'dark'" (change)="setTheme('dark')" />
                  <span class="radio-glow" [class.on]="model.theme === 'dark'"></span>
                  <span>dark</span>
                </label>
                <label class="radio">
                  <input type="radio" name="theme" value="light" [checked]="model.theme === 'light'" (change)="setTheme('light')" />
                  <span class="radio-glow" [class.on]="model.theme === 'light'"></span>
                  <span>light</span>
                </label>
                <label class="radio">
                  <input type="radio" name="theme" value="auto" [checked]="model.theme === 'auto'" (change)="setTheme('auto')" />
                  <span class="radio-glow" [class.on]="model.theme === 'auto'"></span>
                  <span>auto</span>
                </label>
              </div>
            </div>
          </div>

        </section>
      </main>

      <aside class="sidebar" [class.collapsed]="model.sidebarCollapsed">
        <div class="sidebar-header">
          <span class="sidebar-title">🔬 Reactive Lab</span>
          <button class="sidebar-toggle" (click)="toggleSidebar()">{{ model.sidebarArrow }}</button>
        </div>
        <div class="tabs">
          <button [class.active]="model.activeTab === 'tree'" (click)="setTabTree()">tree</button>
          <button [class.active]="model.activeTab === 'state'" (click)="setTabState()">state</button>
        </div>
        <div class="tab-panel">

          @if (model.activeTab === 'tree') {
            <div class="tree">
              <div class="node scope-root">
                <span class="dot"></span>
                <span class="label">profile</span>
                <span class="status">{{ model.completenessSyncedLabel }}</span>
              </div>
              <div class="branch">
                <div class="node scope">
                  <span class="dot"></span>
                  <span class="label">personal</span>
                </div>
                <div class="branch">
                  <div class="node atom" [class.pulse]="model.name">
                    <span class="dot"></span>
                    <span class="label">name</span>
                    <span class="value truncate">{{ model.nameDisplay }}</span>
                  </div>
                  <div class="node atom" [class.pulse]="model.email">
                    <span class="dot"></span>
                    <span class="label">email</span>
                    <span class="value truncate">{{ model.emailDisplay }}</span>
                  </div>
                </div>
                <div class="node scope">
                  <span class="dot"></span>
                  <span class="label">address</span>
                </div>
                <div class="branch">
                  <div class="node atom" [class.pulse]="model.street">
                    <span class="dot"></span>
                    <span class="label">street</span>
                    <span class="value truncate">{{ model.streetDisplay }}</span>
                  </div>
                  <div class="node atom" [class.pulse]="model.country">
                    <span class="dot"></span>
                    <span class="label">country</span>
                    <span class="value truncate">{{ model.countryDisplay }}</span>
                  </div>
                </div>
                <div class="node scope">
                  <span class="dot"></span>
                  <span class="label">preferences</span>
                </div>
                <div class="branch">
                  <div class="node atom" [class.pulse]="model.notifications">
                    <span class="dot"></span>
                    <span class="label">notifications</span>
                    <span class="value">{{ model.notifications }}</span>
                  </div>
                  <div class="node atom pulse">
                    <span class="dot"></span>
                    <span class="label">theme</span>
                    <span class="value">{{ model.theme }}</span>
                  </div>
                </div>
                <div class="node scope" [class.loading]="model.zonesLoading">
                  <span class="dot"></span>
                  <span class="label">async</span>
                </div>
                <div class="branch">
                  <div class="node atom" [class.pulse]="model.zonesReady">
                    <span class="dot"></span>
                    <span class="label">countries</span>
                    <span class="value">{{ model.zonesLabel }}</span>
                  </div>
                </div>
              </div>
            </div>
          }

          @if (model.activeTab === 'state') {
            <pre class="snapshot">{{ model.snapshotText }}</pre>
          }

        </div>
      </aside>

      <footer class="nav">
        <button (click)="goBack()" [disabled]="model.step === 0">← Back</button>
        <div class="step-dots">
          <span [class.on]="model.step === 0"></span>
          <span [class.on]="model.step === 1"></span>
          <span [class.on]="model.step === 2"></span>
        </div>
        @if (model.step === 2) {
          <button (click)="submit()">Submit</button>
        } @else {
          <button (click)="goNext()" [disabled]="model.step === 2">Next →</button>
        }
      </footer>
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
    readonly model = scope<AppModel>({
        step: 0,
        name: '',
        email: '',
        street: '',
        country: '',
        notifications: true,
        theme: 'dark',
        activeTab: 'tree',
        sidebarCollapsed: false,
        toast: null,
        zonesLoading: true,
        zonesReady: self => self.zonesLoading === false,
        selectDisplay: self => (self.zonesLoading ? 'none' : ''),
        countries: [],
        nameDisplay: self => (self.name === '' ? '—' : self.name),
        emailDisplay: self => (self.email === '' ? '—' : self.email),
        streetDisplay: self => (self.street === '' ? '—' : self.street),
        countryDisplay: self => (self.country === '' ? '—' : self.country),
        completeness: self => {
            let score = 0;
            if (self.name) score++;
            if (self.email) score++;
            if (self.street) score++;
            if (self.country) score++;
            return (score / 4) * 100;
        },
        completenessText: self => String(Math.round(self.completeness)),
        completenessLabel: self => `${Math.round(self.completeness)}% complete`,
        completenessSyncedLabel: self => `${Math.round(self.completeness)}% synced`,
        completenessWidth: self => `${self.completeness}%`,
        stageTransform: self => `translateX(calc(-${self.step} * 100% / 3))`,
        namePulse: self => `${self.name.length * 5}%`,
        emailPulse: self => `${self.email.length * 3}%`,
        sidebarArrow: self => (self.sidebarCollapsed ? '◀' : '▶'),
        zonesLabel: self => `${self.countries.length} zones`,
        snapshotText: self => JSON.stringify({
            step: self.step,
            personal: { name: self.name, email: self.email },
            address: { street: self.street, country: self.country },
            preferences: { notifications: self.notifications, theme: self.theme },
            completeness: self.completeness,
        }, null, 2),
    });

    private toastTimer?: ReturnType<typeof setTimeout>;

    ngOnInit(): void {
        // Simulated async zone scan: the compiled template updates the select
        // and the tree as soon as the writes land.
        const scan = setTimeout(() => {
            this.model.zonesLoading = false;
            this.model.countries = ['US', 'CA', 'UK', 'DE', 'FR'];
        }, 1500);
        this.model.cleanups.add(() => clearTimeout(scan));
        this.model.cleanups.add(() => clearTimeout(this.toastTimer));
    }

    ngOnDestroy(): void {
        this.model.dispose();
    }

    goBack(): void {
        this.model.step = Math.max(0, this.model.step - 1);
    }

    goNext(): void {
        this.model.step = Math.min(2, this.model.step + 1);
    }

    setTheme(theme: string): void {
        this.model.theme = theme;
    }

    toggleSidebar(): void {
        this.model.sidebarCollapsed = !this.model.sidebarCollapsed;
    }

    setTabTree(): void {
        this.model.activeTab = 'tree';
    }

    setTabState(): void {
        this.model.activeTab = 'state';
    }

    submit(): void {
        if (this.model.completeness === 100) {
            this.model.toast = 'Profile synchronized successfully';
        } else {
            this.model.toast = `Complete all fields first (${Math.round(this.model.completeness)}%)`;
        }
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.model.toast = null;
        }, 3000);
    }
}
