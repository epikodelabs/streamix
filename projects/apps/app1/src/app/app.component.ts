import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { addListener, bufferCount, debounce, filter, finalize, interval, map, merge, pipe, range, scan, scope, tap, throttle } from '@epikodelabs/streamix';

interface Metric {
    name: string;
    display: string;
    unit: string;
    trend: 'up' | 'down' | 'flat';
}

interface LogEntry {
    time: string;
    message: string;
    type: string;
}

interface Batch {
    label: string;
    items: string[];
}

interface AppState {
    metrics: Metric[];
    sparkline: { height: string }[];
    rawSearchCount: number;
    debouncedSearchCount: number;
    rawSearchLabel: string;
    debouncedLabel: string;
    searchResults: string[];
    batches: Batch[];
    sliderA: number;
    sliderB: number;
    combined: number;
    combinedLabel: string;
    sliderALabel: string;
    sliderBLabel: string;
    sliderABarHeight: string;
    sliderBBarHeight: string;
    combinedBarHeight: string;
    juliaGenerating: boolean;
    juliaProgress: number;
    juliaProgressText: string;
    juliaProgressWidth: string;
    juliaElapsed: number;
    juliaElapsedText: string;
    logEntries: LogEntry[];
}

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [],
    template: `
    <div class="app">
      <header class="header">
        <h1>📊 Stream Monitor</h1>
        <p class="subtitle">Real-time operator demos powered by streamix</p>
      </header>

      <main class="grid">
        <!-- Live Metrics: interval + scan -->
        <section class="card">
          <div class="card-header">
            <h2>Live Metrics</h2>
            <span class="badge">interval + scan</span>
          </div>
          <p class="tooltip">Auto-updating dashboard. No interaction needed — watch metrics drift and the sparkline redraw every 800 ms.</p>
          <div class="metrics">
            @for (m of model.metrics; track m.name) {
              <div class="metric">
                <span class="metric-name">{{ m.name }}</span>
                <span class="metric-value" [class.up]="m.trend === 'up'" [class.down]="m.trend === 'down'">
                  {{ m.display }} {{ m.unit }}
                </span>
              </div>
            }
          </div>
          <div class="sparkline" aria-hidden="true">
            @for (point of model.sparkline; track $index) {
              <span class="spark-bar" [style.height]="point.height"></span>
            }
          </div>
        </section>

        <!-- Search Stream: debounce + filter -->
        <section class="card">
          <div class="card-header">
            <h2>Search Stream</h2>
            <span class="badge">debounce + filter</span>
          </div>
          <p class="tooltip">Type into the input. Events are debounced by 400 ms and filtered to queries longer than 1 character.</p>
          <input
            #searchInput
            type="text"
            placeholder="Type to search..."
            class="search-input"
          />
          <div class="search-meta">
            <span>{{ model.rawSearchLabel }}</span>
            <span>{{ model.debouncedLabel }}</span>
          </div>
          <div class="search-results">
            @for (r of model.searchResults; track r) {
              <div class="result-item">🔍 {{ r }}</div>
            }
            @if (model.searchResults.length === 0) {
              <div class="empty">Waiting for input...</div>
            }
          </div>
        </section>

        <!-- Event Buffer: bufferCount + merge -->
        <section class="card">
          <div class="card-header">
            <h2>Event Buffer</h2>
            <span class="badge">bufferCount + merge</span>
          </div>
          <p class="tooltip">Click the buttons to emit events. They are buffered into batches of 5 via bufferCount before display.</p>
          <div class="buffer-controls">
            <button (click)="emitClick('A')">Emit A</button>
            <button (click)="emitClick('B')">Emit B</button>
            <button (click)="emitClick('C')">Emit C</button>
          </div>
          <div class="buffer-batches">
            @for (batch of model.batches; track batch.label) {
              <div class="batch">
                <span class="batch-label">{{ batch.label }}</span>
                <div class="batch-items">
                  @for (item of batch.items; track $index) {
                    <span class="batch-item">{{ item }}</span>
                  }
                </div>
              </div>
            }
            @if (model.batches.length === 0) {
              <div class="empty">Click buttons to emit events...</div>
            }
          </div>
        </section>

        <!-- Combined Stream: combineLatest -->
        <section class="card wide">
          <div class="card-header">
            <h2>Combined Stream</h2>
            <span class="badge">combineLatest + map</span>
          </div>
          <p class="tooltip">Drag the sliders to change Stream A and B. combineLatest recalculates (A × B) / 100 in real time.</p>
          <div class="combined-controls">
            <label>
              <span>{{ model.sliderALabel }}</span>
              <input type="range" min="0" max="100" [(value)]="model.sliderA" />
            </label>
            <label>
              <span>{{ model.sliderBLabel }}</span>
              <input type="range" min="0" max="100" [(value)]="model.sliderB" />
            </label>
          </div>
          <div class="combined-result">
            <div class="formula">{{ model.combinedLabel }}</div>
            <div class="bar-chart">
              <div class="bar" [style.height]="model.sliderABarHeight">
                <span>A</span>
              </div>
              <div class="bar" [style.height]="model.sliderBBarHeight">
                <span>B</span>
              </div>
              <div class="bar result" [style.height]="model.combinedBarHeight">
                <span>×</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Julia Set: range + map + bufferCount + delay -->
        <section class="card wide">
          <div class="card-header">
            <h2>Julia Set (Non-optimized)</h2>
            <span class="badge">range + map + bufferCount + delay</span>
          </div>
          <p class="tooltip">Click Generate to render a Julia set fractal pixel-by-pixel using reactive stream operators.</p>
          <div class="julia-controls">
            <button (click)="drawJulia()" [disabled]="model.juliaGenerating">Generate</button>
            @if (model.juliaElapsed > 0) {
              <span class="julia-meta">Elapsed: {{ model.juliaElapsedText }} ms</span>
            }
          </div>
          <div class="julia-canvas-wrap">
            <canvas #juliaCanvas width="150" height="150"></canvas>
            @if (model.juliaGenerating) {
              <div class="julia-overlay">
                <div class="julia-progress-bar">
                  <div class="julia-progress-fill" [style.width]="model.juliaProgressWidth"></div>
                </div>
                <span class="julia-progress-text">{{ model.juliaProgressText }}%</span>
              </div>
            }
          </div>
        </section>

        <!-- Log Stream: tap + throttle -->
        <section class="card wide">
          <div class="card-header">
            <h2>Activity Log</h2>
            <span class="badge">tap + throttle</span>
          </div>
          <p class="tooltip">Throttled log stream. Events appear automatically as internal streams produce values.</p>
          <div class="log-panel">
            @for (entry of model.logEntries; track $index) {
              <div class="log-entry" [class.metric]="entry.type === 'metric'" [class.search]="entry.type === 'search'" [class.buffer]="entry.type === 'buffer'" [class.combined]="entry.type === 'combined'">
                <span class="log-time">{{ entry.time }}</span>
                <span class="log-msg">{{ entry.message }}</span>
              </div>
            }
            @if (model.logEntries.length === 0) {
              <div class="empty">No activity yet...</div>
            }
          </div>
        </section>
      </main>

      <footer class="footer">
        <p>Powered by <strong>streamix</strong> · Reactive streams for TypeScript</p>
      </footer>
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

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 20px;
    }
    .grid .wide { grid-column: 1 / -1; }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .card-header h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .badge {
      font-size: 0.7rem;
      background: rgba(91,140,255,0.12);
      color: var(--accent);
      padding: 3px 10px;
      border-radius: 999px;
      font-weight: 500;
      white-space: nowrap;
    }

    .metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .metric {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .metric-name { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .metric-value { font-size: 1.25rem; font-weight: 700; }
    .metric-value.up { color: var(--success); }
    .metric-value.down { color: var(--error); }

    .sparkline { height: 40px; display: flex; align-items: flex-end; gap: 2px; color: var(--accent); }
    .spark-bar {
      flex: 1;
      min-height: 2px;
      background: currentColor;
      opacity: 0.7;
      border-radius: 2px 2px 0 0;
      transition: height 0.3s ease;
    }

    .search-input {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }
    .search-input:focus { border-color: var(--accent); }
    .search-meta {
      display: flex;
      gap: 16px;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .search-results {
      max-height: 160px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .result-item {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 0.85rem;
    }

    .buffer-controls { display: flex; gap: 8px; flex-wrap: wrap; }
    .buffer-controls button {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.15s;
    }
    .buffer-controls button:hover { border-color: var(--accent); background: var(--surface-hover); }
    .buffer-batches { display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; }
    .batch {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .batch-label { font-size: 0.75rem; color: var(--text-muted); min-width: 60px; }
    .batch-items { display: flex; gap: 6px; flex-wrap: wrap; }
    .batch-item {
      background: rgba(91,140,255,0.15);
      color: var(--accent);
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 500;
    }

    .combined-controls {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 16px;
    }
    .combined-controls label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .combined-controls input[type="range"] { width: 100%; accent-color: var(--accent); }

    .combined-result {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .formula { font-size: 1.1rem; font-weight: 600; color: var(--accent); }
    .bar-chart { display: flex; align-items: flex-end; gap: 12px; height: 120px; width: 100%; justify-content: center; }
    .bar {
      width: 48px;
      background: var(--surface-hover);
      border-radius: 6px 6px 0 0;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding-bottom: 6px;
      transition: height 0.2s ease;
      min-height: 4px;
    }
    .bar span { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; }
    .bar.result { background: rgba(91,140,255,0.35); }

    .log-panel {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      max-height: 200px;
      overflow-y: auto;
      scrollbar-width: none;
      font-family: 'Courier New', monospace;
      font-size: 0.8rem;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .log-panel::-webkit-scrollbar { display: none; }
    .log-entry { display: flex; gap: 10px; padding: 3px 0; border-bottom: 1px solid rgba(42,47,63,0.5); }
    .log-entry:last-child { border-bottom: none; }
    .log-time { color: var(--text-muted); min-width: 70px; }
    .log-msg { color: var(--text); }
    .log-entry.metric .log-msg { color: var(--accent); }
    .log-entry.search .log-msg { color: var(--success); }
    .log-entry.buffer .log-msg { color: var(--warning); }
    .log-entry.combined .log-msg { color: #c084fc; }

    .empty { color: var(--text-muted); font-size: 0.85rem; font-style: italic; text-align: center; padding: 12px; }
    .tooltip { color: var(--text-muted); font-size: 0.8rem; margin: 0; }

    .julia-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .julia-controls button {
      background: var(--accent); color: #fff; border: none; border-radius: 8px;
      padding: 8px 16px; font-size: 0.85rem; font-weight: 500; cursor: pointer;
      transition: background 0.15s;
    }
    .julia-controls button:hover:not(:disabled) { background: var(--accent-hover); }
    .julia-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
    .julia-meta { font-size: 0.85rem; color: var(--text-muted); }

    .julia-canvas-wrap { position: relative; display: flex; justify-content: center; }
    .julia-canvas-wrap canvas {
      background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
      width: 300px; height: 300px; image-rendering: pixelated;
    }
    .julia-overlay {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 8px;
      background: rgba(0,0,0,0.5); border-radius: 8px;
    }
    .julia-progress-bar {
      width: 200px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;
    }
    .julia-progress-fill { height: 100%; background: var(--accent); transition: width 0.1s linear; }
    .julia-progress-text { font-size: 0.8rem; color: #fff; font-weight: 500; }

    .footer { text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border); }
    .footer p { color: var(--text-muted); font-size: 0.8rem; margin: 0; }
    .footer strong { color: var(--accent); }
  `],
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
    @ViewChild('searchInput')
    searchInput!: ElementRef<HTMLInputElement>;
    @ViewChild('juliaCanvas')
    juliaCanvas!: ElementRef<HTMLCanvasElement>;

    // Every dynamic template binding reads this scope; the compiled template
    // updates the DOM directly from scope emissions — no change detection.
    readonly model = scope<AppState>({
        metrics: [
            { name: 'Throughput', display: '0.0', unit: 'req/s', trend: 'flat' },
            { name: 'Latency', display: '0.0', unit: 'ms', trend: 'flat' },
            { name: 'Errors', display: '0.0', unit: '%', trend: 'flat' },
            { name: 'Active', display: '0', unit: 'conn', trend: 'flat' },
        ],
        sparkline: [],
        rawSearchLabel: self => `Raw events: ${self.rawSearchCount}`,
        debouncedLabel: self => `Debounced: ${self.debouncedSearchCount}`,
        rawSearchCount: 0,
        debouncedSearchCount: 0,
        searchResults: [],
        batches: [],
        sliderA: 30,
        sliderB: 60,
        combined: self => (self.sliderA * self.sliderB) / 100,
        combinedLabel: self => `(A × B) / 100 = ${self.combined.toFixed(1)}`,
        sliderALabel: self => `Stream A (${self.sliderA})`,
        sliderBLabel: self => `Stream B (${self.sliderB})`,
        sliderABarHeight: self => `${self.sliderA}%`,
        sliderBBarHeight: self => `${self.sliderB}%`,
        combinedBarHeight: self => `${self.combined}%`,
        juliaGenerating: false,
        juliaProgress: 0,
        juliaProgressText: self => String(Math.round(self.juliaProgress)),
        juliaProgressWidth: self => `${self.juliaProgress}%`,
        juliaElapsed: 0,
        juliaElapsedText: self => String(Math.round(self.juliaElapsed)),
        logEntries: [],
    });

    private sparklineHistory: number[] = [];
    private batchCounter = 0;
    private readonly clickBuffer: string[] = [];

    ngOnInit(): void {
        this.initMetricsStream();
        this.initLogStream();
    }

    ngAfterViewInit(): void {
        this.initSearchStream();
    }

    ngOnDestroy(): void {
        this.model.dispose();
    }

    emitClick(label: string): void {
        this.clickBuffer.push(label);
        if (this.clickBuffer.length < 5) return;
        const items = this.clickBuffer.splice(0, this.clickBuffer.length);
        this.batchCounter += 1;
        this.model.batches = [
            { label: `Batch ${this.batchCounter}`, items },
            ...this.model.batches,
        ].slice(0, 8);
    }

    drawJulia(): void {
        const canvas = this.juliaCanvas?.nativeElement;
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d')!;
        const width = canvas.width;
        const height = canvas.height;
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;
        this.model.juliaGenerating = true;
        this.model.juliaProgress = 0;
        this.model.juliaElapsed = 0;
        const startTime = performance.now();
        const maxIterations = 60;
        const zoom = 55;
        const centerX = width / 2;
        const centerY = height / 2;
        const juliaC = { x: -0.7, y: 0.27015 };
        const julia = (zx: number, zy: number): number => {
            for (let i = 0; i < maxIterations; i++) {
                const x2 = zx * zx, y2 = zy * zy;
                if (x2 + y2 > 4)
                    return i;
                const tmp = x2 - y2 + juliaC.x;
                zy = 2 * zx * zy + juliaC.y;
                zx = tmp;
            }
            return maxIterations;
        };
        const getColor = (iteration: number): [
            number,
            number,
            number
        ] => {
            if (iteration === maxIterations)
                return [0, 0, 0];
            const t = iteration / maxIterations;
            const r = Math.floor(9 * (1 - t) * t * t * t * 255);
            const g = Math.floor(15 * (1 - t) * (1 - t) * t * t * 255);
            const b = Math.floor(8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255);
            return [r, g, b];
        };
        const batchSize = 200;
        let pixelsDone = 0;
        const unsubscribe = pipe(range(0, width * height), map((i: number) => {
            const px = i % width;
            const py = Math.floor(i / width);
            const x0 = (px - centerX) / zoom;
            const y0 = (py - centerY) / zoom;
            const iter = julia(x0, y0);
            const [r, g, b] = getColor(iter);
            return { i, r, g, b };
        }), bufferCount(batchSize), tap(async (batch: Array<{
            i: number;
            r: number;
            g: number;
            b: number;
        }>) => {
            for (const p of batch) {
                const idx = p.i * 4;
                data[idx] = p.r;
                data[idx + 1] = p.g;
                data[idx + 2] = p.b;
                data[idx + 3] = 255;
            }
            pixelsDone += batch.length;
            this.model.juliaProgress = (pixelsDone / (width * height)) * 100;
            ctx.putImageData(imageData, 0, 0);
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
        }), finalize(() => {
            this.model.juliaElapsed = performance.now() - startTime;
            this.model.juliaGenerating = false;
        })).subscribe(() => { });
        this.model.cleanups.add(() => unsubscribe());
    }

    private initMetricsStream(): void {
        const s = pipe(interval(800), scan(acc => {
            const throughput = Math.max(0, acc.throughput + (Math.random() - 0.5) * 40);
            const latency = Math.max(5, acc.latency + (Math.random() - 0.5) * 10);
            const errors = Math.max(0, Math.min(5, acc.errors + (Math.random() - 0.5) * 0.5));
            const active = Math.max(0, acc.active + Math.floor((Math.random() - 0.5) * 6));
            return { throughput, latency, errors, active };
        }, { throughput: 120, latency: 45, errors: 0.5, active: 24 }), tap(({ throughput, latency, errors, active }) => {
            this.model.metrics = [
                { name: 'Throughput', display: throughput.toFixed(1), unit: 'req/s', trend: throughput > 120 ? 'up' : 'down' },
                { name: 'Latency', display: latency.toFixed(1), unit: 'ms', trend: latency < 45 ? 'up' : 'down' },
                { name: 'Errors', display: errors.toFixed(1), unit: '%', trend: errors < 0.5 ? 'up' : 'down' },
                { name: 'Active', display: String(active), unit: 'conn', trend: active > 24 ? 'up' : 'down' },
            ];
            this.sparklineHistory.push(throughput);
            if (this.sparklineHistory.length > 30)
                this.sparklineHistory.shift();
            const min = Math.min(...this.sparklineHistory);
            const max = Math.max(...this.sparklineHistory);
            const range = max - min || 1;
            this.model.sparkline = this.sparklineHistory.map(v => ({
                height: `${8 + ((v - min) / range) * 92}%`,
            }));
        })).subscribe(() => { });
        this.model.cleanups.add(() => s());
    }

    private initSearchStream(): void {
        const input = this.searchInput?.nativeElement;
        if (!input)
            return;
        const value$ = pipe(addListener(input, 'input'), map(() => input.value as string));
        // Raw counter
        const rawUnsubscribe = pipe(value$, tap(() => { this.model.rawSearchCount++; })).subscribe(() => { });
        this.model.cleanups.add(() => rawUnsubscribe());
        // Debounced results
        const unsubscribe = pipe(value$, debounce(400), filter((q: string) => q.length > 1), tap(() => { this.model.debouncedSearchCount++; }), tap((query: string) => {
            this.model.searchResults = [
                `Matched "${query}" (${Math.floor(Math.random() * 50)} results)`,
                ...this.model.searchResults,
            ].slice(0, 5);
        })).subscribe(() => { });
        this.model.cleanups.add(() => unsubscribe());
    }

    private initLogStream(): void {
        const metricLog$ = pipe(interval(2000), throttle(2000), map(() => {
            const names = ['Throughput spike detected', 'Latency normalized', 'Connection pool resized', 'Cache invalidated'];
            return names[Math.floor(Math.random() * names.length)];
        }), tap(msg => this.pushLog(msg, 'metric')));
        const searchLog$ = pipe(interval(3500), throttle(3500), map(() => 'Search index refreshed'), tap(msg => this.pushLog(msg, 'search')));
        const bufferLog$ = pipe(interval(5000), throttle(5000), map(() => `Buffer flushed — ${this.model.batches.length} active batches`), tap(msg => this.pushLog(msg, 'buffer')));
        const combinedLog$ = pipe(interval(4200), throttle(4200), map(() => `Combined recalculated: A=${this.model.sliderA}, B=${this.model.sliderB}`), tap(msg => this.pushLog(msg, 'combined')));
        const s = merge(metricLog$, searchLog$, bufferLog$, combinedLog$).subscribe(() => { });
        this.model.cleanups.add(() => s());
    }

    private pushLog(message: string, type: string): void {
        const time = new Date().toLocaleTimeString();
        this.model.logEntries = [{ time, message, type }, ...this.model.logEntries].slice(0, 40);
    }
}
