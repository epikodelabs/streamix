import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  OnDestroy,
  QueryList,
  signal,
  ViewChildren,
} from '@angular/core';
import {
  createValueTracer,
  disableTracing,
  enableTracing,
  type ValueState,
  type ValueTrace,
} from '@epikodelabs/streamix/tracing';
import { drawingWorker, type DrawingInput, type DrawingOutput, type DrawingCircle } from './drawing.worker.js';
import { runDemoStream } from './demo-stream';

type CanvasCircle = DrawingCircle;

const STATE_COLORS: Record<ValueState, { accent: string }> = {
  emitted: { accent: '#9ca3af' },
  transformed: { accent: '#38bdf8' },
  filtered: { accent: '#f59e0b' },
  collapsed: { accent: '#1d4ed8' },
  expanded: { accent: '#8b5cf6' },
  errored: { accent: '#dc2626' },
  delivered: { accent: '#0ea5e9' },
  dropped: { accent: '#00ce07ff' },
};

const STATE_ORDER: ValueState[] = [
  'delivered',
  'expanded',
  'filtered',
  'collapsed',
  'errored',
  'dropped',
  'emitted',
  'transformed',
];

const SUBSCRIPTION_PALETTE = ['#0ea5e9', '#a855f7', '#fb923c', '#34d399', '#f43f5e'];

@Component({
  selector: 'app-tracing-visualizer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styles: [
    `
      /* make the container scroll horizontally if diagram is wide */
      .diagram-shell {
        position: relative;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #fbfcfe;
        overflow-x: auto;
        overflow-y: hidden;
        max-width: 100%;
      }

      .diagram-canvas {
        display: block;
        cursor: crosshair;
      }

      .diagram-shell {
        scroll-behavior: smooth;
      }

      .diagram-shell::-webkit-scrollbar {
        height: 6px;
      }
      .diagram-shell::-webkit-scrollbar-track {
        background: #f3f4f6;
      }
      .diagram-shell::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 3px;
      }
      .diagram-shell::-webkit-scrollbar-thumb:hover {
        background: #9ca3af;
      }
    `,
  ],
})
export class TracingVisualizerComponent implements AfterViewInit, OnDestroy {
  @ViewChildren('diagramCanvas') private diagramCanvases?: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChildren('diagramContainer') private diagramContainers?: QueryList<ElementRef<HTMLDivElement>>;

  private animationFrame?: number;
  private hasView = false;

  private circleRegistry = new Map<string, CanvasCircle[]>();

  // Chronological (arrival) order — NO SORTING.
  private traceList: ValueTrace[] = [];
  private traceIndexById = new Map<string, number>();

  private tracer = createValueTracer({
    onTraceUpdate: (trace) => this.handleTraceUpdate(trace),
  });

  readonly traces = signal<ValueTrace[]>([]);
  readonly searchTerm = signal('');
  readonly filterState = signal<'all' | ValueState>('all');
  readonly selectedTrace = signal<ValueTrace | null>(null);
  readonly demoOutputs = signal<number[]>([]);

  readonly demoTracerOutputs = computed(() => {
    const subs = this.subscriptionOrder();
    if (subs.length === 0) return [] as any[];
    const subscriptionId = subs[0];

    return this.traces()
      .filter(
        (t) =>
          // Include values from the main subscription or any values that are expanded from it
          (t.subscriptionId === subscriptionId || t.streamId.startsWith('str_1')) &&
          t.state === 'delivered' &&
          (t.operatorSteps ?? []).some((s) => s.operatorName === 'debounce')
      )
      .slice()
      .sort((a, b) => (a.deliveredAt ?? 0) - (b.deliveredAt ?? 0))
      .map((t) => t.finalValue);
  });

  readonly demoOutputsMatchTracer = computed(() => {
    const a = this.demoOutputs();
    const b = this.demoTracerOutputs();
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  });

  // NOTE: this keeps chronological order because `filter()` preserves array order.
  readonly filteredTraces = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    const filter = this.filterState();
    const list = this.traces();

    return list.filter((trace) => {
      const name = trace.streamName?.toLowerCase() ?? '';
      const matchesSearch = !query || trace.valueId.includes(query) || name.includes(query);
      const matchesFilter = filter === 'all' || trace.state === filter;
      return matchesSearch && matchesFilter;
    });
  });

  readonly subscriptionOrder = computed(() => {
    const set = new Set<string>();
    // Set preserves insertion order -> first time we see a subscription in chronological list
    this.filteredTraces().forEach((t) => set.add(t.subscriptionId));
    return Array.from(set);
  });

  readonly groupedTraces = computed(() =>
    this.subscriptionOrder().map((subscriptionId) => ({
      subscriptionId,
      // still chronological within subscription because filteredTraces is chronological
      traces: this.filteredTraces().filter((t) => t.subscriptionId === subscriptionId),
    }))
  );

  readonly stats = computed(() => {
    const current = this.traces();
    const counters: Record<ValueState, number> = {
      emitted: 0,
      transformed: 0,
      filtered: 0,
      collapsed: 0,
      expanded: 0,
      errored: 0,
      delivered: 0,
      dropped: 0,
    };
    current.forEach((t) => counters[t.state]++);
    return { total: current.length, throughput: Number((current.length / 12).toFixed(1)), counters };
  });

  readonly stateOptions = STATE_ORDER;

  readonly hoveredCircle = signal<CanvasCircle | null>(null);
  readonly hoverPosition = signal<{ left: number; top: number } | null>(null);

  constructor() {
    effect(() => {
      // redraw when filters change or traces update
      this.filteredTraces();
      this.subscriptionOrder();
      if (this.hasView) this.scheduleDraw();
    });
  }

  ngAfterViewInit() {
    this.hasView = true;

    enableTracing(this.tracer);
    this.demoOutputs.set([]);
    runDemoStream({
      onOut: (value) => this.demoOutputs.update((prev) => [...prev, value]),
      onDone: () => {
        // Allow tracer to flush any final updates before comparison.
        setTimeout(() => {
          if (!this.demoOutputsMatchTracer()) {
            // eslint-disable-next-line no-console
            console.warn('demo-sophisticated mismatch', {
              streamOutputs: this.demoOutputs(),
              tracerDelivered: this.demoTracerOutputs(),
            });
          }
        }, 0);
      },
    });

    this.drawDiagram();
    window.addEventListener('resize', this.resizeHandler);
    this.diagramCanvases?.changes.subscribe(() => this.scheduleDraw());
  }

  ngOnDestroy() {
    window.removeEventListener('resize', this.resizeHandler);
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    disableTracing();
  }

  private resizeHandler = () => this.drawDiagram();

  private scheduleDraw() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = requestAnimationFrame(() => this.drawDiagram());
  }

  getSubscriptionAccent(subId: string) {
    const idx = this.subscriptionOrder().indexOf(subId);
    return SUBSCRIPTION_PALETTE[idx % SUBSCRIPTION_PALETTE.length];
  }

  /* -------------------------------------------------------------------------- */
  /* Axis labels                                                                 */
  /* -------------------------------------------------------------------------- */

  private getAxisLabelsForTraces(traces: ValueTrace[]) {
    const labelByIndex = new Map<number, string>();
    let maxIndex = -1;

    traces.forEach((trace) => {
      trace.operatorSteps?.forEach((step) => {
        if (step.operatorIndex > maxIndex) maxIndex = step.operatorIndex;
        if (!labelByIndex.has(step.operatorIndex) && step.operatorName) {
          labelByIndex.set(step.operatorIndex, step.operatorName);
        }
      });
    });

    if (maxIndex < 0) return ['deliver'];

    const labels = Array.from({ length: maxIndex + 1 }, (_, i) => labelByIndex.get(i) ?? `op${i}`);
    labels.push('deliver');
    return labels;
  }

  /* -------------------------------------------------------------------------- */
  /* Main draw                                                                   */
  /* -------------------------------------------------------------------------- */

  private drawDiagram() {
    const groups = this.groupedTraces();
    this.circleRegistry.clear();

    const canvases = this.diagramCanvases?.toArray() ?? [];
    const containers = this.diagramContainers?.toArray() ?? [];

    groups.forEach((group, idx) => {
      const canvas = canvases[idx]?.nativeElement;
      const container = containers[idx]?.nativeElement;
      if (!canvas || !container) return;
      void this.drawSubscriptionDiagram(group.subscriptionId, canvas, container, group.traces);
    });
  }

  private async drawSubscriptionDiagram(
    subscriptionId: string,
    canvas: HTMLCanvasElement,
    container: HTMLDivElement,
    traces: ValueTrace[]
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padding = { top: 32, right: 32, bottom: 40, left: 110 };
    const rowHeight = 36;

    const axisLabels = this.getAxisLabelsForTraces(traces);
    const strokeCount = Math.max(2, axisLabels.length);

    // Wide canvas to enable horizontal scrolling for long operator chains
    const columnSpacing = 120;
    const calculatedWidth = padding.left + (strokeCount - 1) * columnSpacing + padding.right;
    const minWidth = Math.max(600, container.clientWidth);
    const width = Math.max(minWidth, calculatedWidth);

    // Strict chronological vertical order: row == index in `traces`.
    const totalRows = traces.length;
    const height = Math.max(220, totalRows * rowHeight + padding.top + padding.bottom);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // Build the chronological index map
    const chronologicalIndexMap: Record<string, number> = {};
    traces.forEach((t) => {
      const traceIndex = this.traceIndexById.get(t.valueId);
      if (traceIndex !== undefined) {
        chronologicalIndexMap[t.valueId] = traceIndex;
      }
    });

    try {
      const input: DrawingInput = {
        traces: traces as any[],
        axisLabels,
        canvasWidth: width,
        canvasHeight: height,
        devicePixelRatio: dpr,
        padding,
        subscriptionId,
        chronologicalIndexMap,
      };

      const result: DrawingOutput = await drawingWorker.processTask(input);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(result.imageBitmap, 0, 0, width, height);

      this.circleRegistry.set(subscriptionId, result.circles);

      if (typeof (result.imageBitmap as any).close === 'function') {
        (result.imageBitmap as any).close();
      }
    } catch (error) {
      console.error('Drawing worker error:', error);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#ef4444';
      ctx.font = '14px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Error rendering diagram', width / 2, height / 2);
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Mouse / tooltip                                                             */
  /* -------------------------------------------------------------------------- */

  onCanvasMouseMove(event: MouseEvent, subscriptionId: string) {
    const canvas = event.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const circles = this.circleRegistry.get(subscriptionId) ?? [];
    const hit = circles.find((circle) => {
      const dx = circle.x - x;
      const dy = circle.y - y;
      return dx * dx + dy * dy <= (circle.radius + 6) ** 2;
    });

    if (hit) {
      this.hoveredCircle.set(hit);
      this.hoverPosition.set({ left: event.clientX + 14, top: event.clientY + 14 });
    } else {
      this.clearHoveredCircle();
    }
  }

  clearHoveredCircle() {
    this.hoveredCircle.set(null);
    this.hoverPosition.set(null);
  }

  /* -------------------------------------------------------------------------- */
  /* Controls                                                                     */
  /* -------------------------------------------------------------------------- */

  refreshTraces() {
    // hard reset ordering buffers
    this.traceList = [];
    this.traceIndexById.clear();

    this.traces.set([]);
    this.selectedTrace.set(null);
    this.clearHoveredCircle();

    this.demoOutputs.set([]);
    runDemoStream({
      onOut: (value) => this.demoOutputs.update((prev) => [...prev, value]),
      onDone: () => {
        setTimeout(() => {
          if (!this.demoOutputsMatchTracer()) {
            // eslint-disable-next-line no-console
            console.warn('demo-sophisticated mismatch', {
              streamOutputs: this.demoOutputs(),
              tracerDelivered: this.demoTracerOutputs(),
            });
          }
        }, 0);
      },
    });
  }

  setSearchTerm(value: string) {
    this.searchTerm.set(value);
  }

  setFilterState(state: 'all' | ValueState) {
    this.filterState.set(state);
    this.clearHoveredCircle();
  }

  onSearch(event: Event) {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    this.setSearchTerm(value);
  }

  selectTrace(trace: ValueTrace) {
    this.selectedTrace.set(this.selectedTrace()?.valueId === trace.valueId ? null : trace);
  }

  trackByTrace(_: number, trace: ValueTrace) {
    return trace.valueId;
  }

  /* -------------------------------------------------------------------------- */
  /* Helpers referenced by template                                               */
  /* -------------------------------------------------------------------------- */

  formatDuration(ms: number | undefined) {
    if (!ms) return '?';
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  formatTime(value: number) {
    return new Date(value).toLocaleTimeString('en-US', {
      hour12: false,
      minute: '2-digit',
      second: '2-digit',
    });
  }

  formatCircleValue(value?: any) {
    if (value === undefined || value === null) return 'N/A';
    if (typeof value === 'number') return value.toFixed(2);
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  getCircleDisplayValue(circle?: CanvasCircle | null) {
    if (!circle) return undefined;
    if (circle.value !== undefined) return circle.value;

    const steps = circle.trace?.operatorSteps ?? [];
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const step = steps[i];
      if (step.operatorName === circle.operatorName && step.outputValue !== undefined) {
        return step.outputValue;
      }
    }
    return circle.trace?.finalValue ?? circle.trace?.sourceValue;
  }

  getSelectedOperatorCount() {
    return this.selectedTrace()?.operatorSteps.length ?? 0;
  }

  getStateAccent(state?: ValueState) {
    if (!state) return '#475467';
    return STATE_COLORS[state]?.accent ?? '#475467';
  }

  /* -------------------------------------------------------------------------- */
  /* Chronological trace ingestion (NO SORTING)                                   */
  /* -------------------------------------------------------------------------- */

  private handleTraceUpdate(trace: ValueTrace) {
    const existingIndex = this.traceIndexById.get(trace.valueId);

    if (existingIndex === undefined) {
      // first time we see this trace -> append (chronological)
      this.traceIndexById.set(trace.valueId, this.traceList.length);
      this.traceList.push(trace);
    } else {
      // update in place without changing order
      this.traceList[existingIndex] = trace;
    }

    // push snapshot
    this.traces.set(this.traceList.slice());
  }
}
