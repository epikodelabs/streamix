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
  type OperatorStep,
  type ValueState,
  type ValueTrace,
} from '@epikodelabs/streamix/tracing';
import { runDemoStream } from './demo-stream';

interface ValueTraceWithExpansion extends ValueTrace {
  expandedFrom?: {
    operatorIndex: number;
    operatorName: string;
    baseValueId: string;
  };
}

interface CanvasCircle {
  id: string;
  x: number;
  y: number;
  radius: number;
  label: 'emit' | 'output';
  value?: any;
  operatorName: string;
  trace: ValueTrace;
  state: ValueState;
  subscriptionId: string;
  isTerminal: boolean;
  hasValue: boolean;
  hasStep: boolean;
}

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
    runDemoStream();

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
      this.drawSubscriptionDiagram(group.subscriptionId, canvas, container, group.traces);
    });
  }

  private drawSubscriptionDiagram(
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
    const operatorCount = Math.max(0, axisLabels.length - 1); // excludes deliver
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const chartWidth = width - padding.left - padding.right;
    const columnWidth = (strokeCount - 1) > 0 ? chartWidth / (strokeCount - 1) : chartWidth;
    const getStrokeX = (i: number) => padding.left + i * columnWidth;
    const getColumnCenter = (i: number) => padding.left + i * columnWidth + columnWidth / 2;

    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#fbfcfe');
    grad.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Vertical strokes
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    for (let i = 0; i < axisLabels.length; i += 1) {
      const x = getStrokeX(i);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
    }

    // Labels
    ctx.font = '11px "Inter", sans-serif';
    ctx.fillStyle = '#475467';
    ctx.textAlign = 'center';
    axisLabels.slice(0, -1).forEach((label, i) => {
      ctx.fillText(label.toUpperCase(), getColumnCenter(i), height - padding.bottom + 16);
    });

    type Point = { x: number; y: number };

    const groupCircles: CanvasCircle[] = [];
    let circleCounter = 0;

    const tracesById = new Map<string, ValueTrace>();
    const indexByValueId = new Map<string, number>();
    traces.forEach((t, i) => {
      tracesById.set(t.valueId, t);
      indexByValueId.set(t.valueId, i);
    });

    // Determine "collapsed target" markers (so the target can be drawn as collapsed)
    const collapsedTargetsByStroke = new Set<string>();
    traces.forEach((trace) => {
      const c = trace.collapsedInto;
      if (!c) return;
      collapsedTargetsByStroke.add(`${c.targetValueId}:${c.operatorIndex + 1}`);
    });

    const expansionLinks: Array<{ from: Point; to: Point }> = [];
    const collapseLinks: Array<{ from: Point; to: Point }> = [];

    const drawCurve = (from: Point, to: Point, state: ValueState) => {
      const accent = STATE_COLORS[state]?.accent ?? STATE_COLORS.emitted.accent;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);

      if (Math.abs(from.y - to.y) < 2) {
        ctx.lineTo(to.x, to.y);
      } else {
        const midX = (from.x + to.x) / 2;
        ctx.bezierCurveTo(midX, from.y, midX, to.y, to.x, to.y);
      }

      ctx.stroke();
    };

    const makeCircle = (
      trace: ValueTrace,
      state: ValueState,
      cfg: {
        x: number;
        y: number;
        label: 'emit' | 'output';
        value?: any;
        hasValue: boolean;
        hasStep: boolean;
        operatorName: string;
        isTerminal: boolean;
      }
    ): CanvasCircle => ({
      id: `${subscriptionId}:${circleCounter++}`,
      x: cfg.x,
      y: cfg.y,
      radius: 6,
      label: cfg.label,
      value: cfg.value,
      operatorName: cfg.operatorName,
      trace,
      state,
      subscriptionId,
      isTerminal: cfg.isTerminal,
      hasValue: cfg.hasValue,
      hasStep: cfg.hasStep,
    });

    // Draw per trace (chronological rows)
    traces.forEach((trace, row) => {
      const y = padding.top + row * rowHeight + rowHeight / 2;

      const stepsByIndex = new Map<number, OperatorStep>();
      (trace.operatorSteps ?? []).forEach((s) => stepsByIndex.set(s.operatorIndex, s));

      const expandedFrom = (trace as ValueTraceWithExpansion).expandedFrom;

      let lastPoint: Point | undefined;
      let stopped = false;

      if (expandedFrom) {
        // Expanded traces start at the operator output column (operatorIndex + 1)
        const startOpIndex = expandedFrom.operatorIndex;
        const startX = getStrokeX(startOpIndex + 1);
        const startStep = stepsByIndex.get(startOpIndex);
        const value = startStep?.outputValue ?? trace.finalValue;

        const startCircle = makeCircle(trace, 'expanded', {
          x: startX,
          y,
          label: 'output',
          value,
          hasValue: value !== undefined,
          hasStep: true,
          operatorName: expandedFrom.operatorName,
          isTerminal: false,
        });
        groupCircles.push(startCircle);
        lastPoint = { x: startX, y };

        // Continue drawing steps after the expansion point
        for (let opIndex = startOpIndex + 1; opIndex < operatorCount; opIndex += 1) {
          const step = stepsByIndex.get(opIndex);
          if (!step) break;

          // If this trace collapses into another at this operator
          if (trace.collapsedInto?.operatorIndex === opIndex) {
            const targetIndex = indexByValueId.get(trace.collapsedInto.targetValueId);
            if (targetIndex !== undefined && lastPoint) {
              const targetY = padding.top + targetIndex * rowHeight + rowHeight / 2;
              const targetX = getStrokeX(opIndex + 1);
              collapseLinks.push({ from: lastPoint, to: { x: targetX, y: targetY } });
            }
            stopped = true;
            break;
          }

          let state = (step.outcome ?? 'transformed') as ValueState;
          if (
            state !== 'filtered' &&
            state !== 'errored' &&
            collapsedTargetsByStroke.has(`${trace.valueId}:${opIndex + 1}`)
          ) {
            state = 'collapsed';
          }

          const outX = getStrokeX(opIndex + 1);
          const outPoint = { x: outX, y };
          if (lastPoint) drawCurve(lastPoint, outPoint, state);

          const isTerminal = state === 'filtered' || state === 'errored' || state === 'dropped';
          const valueOut = isTerminal ? undefined : step.outputValue;

          groupCircles.push(
            makeCircle(trace, state, {
              x: outX,
              y,
              label: 'output',
              value: valueOut,
              hasValue: valueOut !== undefined,
              hasStep: true,
              operatorName: step.operatorName ?? axisLabels[opIndex],
              isTerminal,
            })
          );

          lastPoint = outPoint;
          if (isTerminal) {
            stopped = true;
            break;
          }
        }
      } else {
        // Normal trace starts at emission column (0)
        const emitX = getStrokeX(0);
        groupCircles.push(
          makeCircle(trace, 'emitted', {
            x: emitX,
            y,
            label: 'emit',
            value: trace.sourceValue,
            hasValue: trace.sourceValue !== undefined,
            hasStep: true,
            operatorName: 'emit',
            isTerminal: false,
          })
        );
        lastPoint = { x: emitX, y };

        for (let opIndex = 0; opIndex < operatorCount; opIndex += 1) {
          const step = stepsByIndex.get(opIndex);
          if (!step) break;

          if (trace.collapsedInto?.operatorIndex === opIndex) {
            const targetIndex = indexByValueId.get(trace.collapsedInto.targetValueId);
            if (targetIndex !== undefined && lastPoint) {
              const targetY = padding.top + targetIndex * rowHeight + rowHeight / 2;
              const targetX = getStrokeX(opIndex + 1);
              collapseLinks.push({ from: lastPoint, to: { x: targetX, y: targetY } });
            }
            stopped = true;
            break;
          }

          let state = (step.outcome ?? 'transformed') as ValueState;
          if (
            state !== 'filtered' &&
            state !== 'errored' &&
            collapsedTargetsByStroke.has(`${trace.valueId}:${opIndex + 1}`)
          ) {
            state = 'collapsed';
          }

          const outX = getStrokeX(opIndex + 1);
          const outPoint = { x: outX, y };
          if (lastPoint) drawCurve(lastPoint, outPoint, state);

          const isTerminal = state === 'filtered' || state === 'errored' || state === 'dropped';
          const valueOut = isTerminal ? undefined : step.outputValue;

          groupCircles.push(
            makeCircle(trace, state, {
              x: outX,
              y,
              label: 'output',
              value: valueOut,
              hasValue: valueOut !== undefined,
              hasStep: true,
              operatorName: step.operatorName ?? axisLabels[opIndex],
              isTerminal,
            })
          );

          lastPoint = outPoint;
          if (isTerminal) {
            stopped = true;
            break;
          }
        }
      }

      // Deliver node only when deliveredAt exists and we didn’t stop early
      if (!stopped && trace.deliveredAt && lastPoint) {
        const deliverX = getStrokeX(axisLabels.length - 1);
        const deliverPoint = { x: deliverX, y };
        drawCurve(lastPoint, deliverPoint, 'delivered');

        groupCircles.push(
          makeCircle(trace, 'delivered', {
            x: deliverX,
            y,
            label: 'output',
            value: trace.finalValue,
            hasValue: trace.finalValue !== undefined,
            hasStep: true,
            operatorName: 'deliver',
            isTerminal: true,
          })
        );
      }
    });

    // Expansion links (connect base operator stroke -> child start stroke)
    traces.forEach((child) => {
      const ex = (child as ValueTraceWithExpansion).expandedFrom;
      if (!ex) return;

      const baseIndex = indexByValueId.get(ex.baseValueId);
      const childIndex = indexByValueId.get(child.valueId);
      if (baseIndex === undefined || childIndex === undefined) return;

      const baseY = padding.top + baseIndex * rowHeight + rowHeight / 2;
      const childY = padding.top + childIndex * rowHeight + rowHeight / 2;

      const originOpIndex = ex.operatorIndex;

      expansionLinks.push({
        from: { x: getStrokeX(originOpIndex), y: baseY },
        to: { x: getStrokeX(originOpIndex + 1), y: childY },
      });
    });

    // Draw links last, so they sit behind circles but on top of background
    collapseLinks.forEach(({ from, to }) => drawCurve(from, to, 'collapsed'));
    expansionLinks.forEach(({ from, to }) => drawCurve(from, to, 'expanded'));

    // Draw circles (final)
    groupCircles.forEach((circle) => {
      const circleColor = STATE_COLORS[circle.state] ?? STATE_COLORS.emitted;

      ctx.beginPath();
      ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);

      if (!circle.hasStep) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
      } else if (circle.isTerminal) {
        ctx.fillStyle = circleColor.accent;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
      } else {
        ctx.fillStyle = circle.hasValue ? '#fff' : '#f8fafc';
        ctx.strokeStyle = circleColor.accent;
        ctx.lineWidth = 2;
      }

      ctx.fill();
      ctx.stroke();
    });

    this.circleRegistry.set(subscriptionId, groupCircles);

    // Title
    ctx.textAlign = 'center';
    ctx.font = '12px "Inter", sans-serif';
    ctx.fillStyle = '#475467';
    ctx.fillText('Operator flow / timeline', padding.left + chartWidth / 2, padding.top - 12);
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

    runDemoStream();
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
