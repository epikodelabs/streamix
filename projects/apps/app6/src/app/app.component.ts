import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, computed, effect, ElementRef, OnDestroy, QueryList, signal, ViewChildren } from '@angular/core';
import { createValueTracer, disableTracing, enableTracing, type OperatorStep, type ValueState, type ValueTrace } from '@epikodelabs/streamix/tracing';
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
  value?: number;
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
};

const STATE_ORDER: ValueState[] = [
  'delivered',
  'expanded',
  'filtered',
  'collapsed',
  'errored',
  'emitted',
  'transformed',
];

const SUBSCRIPTION_PALETTE = ['#0ea5e9', '#a855f7', '#fb923c', '#34d399', '#f43f5e'];

@Component({
  selector: 'app-tracing-visualizer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
})
export class TracingVisualizerComponent implements AfterViewInit, OnDestroy {
  @ViewChildren('diagramCanvas') private diagramCanvases?: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChildren('diagramContainer') private diagramContainers?: QueryList<ElementRef<HTMLDivElement>>;

  private animationFrame?: number;
  private hasView = false;
  private circleRegistry = new Map<string, CanvasCircle[]>();
  private traceMap = new Map<string, ValueTrace>();
  private tracer = createValueTracer({
    onTraceUpdate: (trace) => this.handleTraceUpdate(trace),
  });

  readonly traces = signal<ValueTrace[]>([]);
  readonly searchTerm = signal('');
  readonly filterState = signal<'all' | ValueState>('all');
  readonly selectedTrace = signal<ValueTrace | null>(null);

  readonly filteredTraces = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    const filter = this.filterState();
    return this.traces()
      .filter((trace) => {
        const name = trace.streamName?.toLowerCase() ?? '';
        const matchesSearch = !query || trace.valueId.includes(query) || name.includes(query);
        const matchesFilter = filter === 'all' || trace.state === filter;
        return matchesSearch && matchesFilter;
      })
      .sort((a, b) => (a.deliveredAt ?? a.emittedAt) - (b.deliveredAt ?? b.emittedAt));
  });

  readonly subscriptionOrder = computed(() => {
    const set = new Set<string>();
    this.filteredTraces().forEach((trace) => set.add(trace.subscriptionId));
    return Array.from(set);
  });

  readonly groupedTraces = computed(() =>
    this.subscriptionOrder().map((subscriptionId) => ({
      subscriptionId,
      traces: this.filteredTraces().filter((trace) => trace.subscriptionId === subscriptionId),
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
    };
    current.forEach((trace) => counters[trace.state]++);
    return { total: current.length, throughput: Number((current.length / 12).toFixed(1)), counters };
  });

  readonly stateOptions = STATE_ORDER;
  readonly hoveredCircle = signal<CanvasCircle | null>(null);
  readonly hoverPosition = signal<{ left: number; top: number } | null>(null);

  constructor() {
    effect(() => {
      this.filteredTraces();
      this.subscriptionOrder();
      if (this.hasView) {
        this.scheduleDraw();
      }
    });
  }

  ngAfterViewInit() {
    this.hasView = true;
    this.drawDiagram();
    enableTracing(this.tracer);
    runDemoStream();
    window.addEventListener('resize', this.resizeHandler);
    this.diagramCanvases?.changes.subscribe(() => this.scheduleDraw());
  }

  ngOnDestroy() {
    window.removeEventListener('resize', this.resizeHandler);
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    disableTracing();
  }

  private resizeHandler = () => this.drawDiagram();

  private scheduleDraw() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.animationFrame = requestAnimationFrame(() => this.drawDiagram());
  }

  getSubscriptionAccent(subId: string) {
    const index = this.subscriptionOrder().indexOf(subId);
    return SUBSCRIPTION_PALETTE[index % SUBSCRIPTION_PALETTE.length];
  }

  private getAxisLabelsForTraces(traces: ValueTrace[]) {
    const labelByIndex = new Map<number, string>();
    let maxIndex = -1;

    traces.forEach((trace) => {
      trace.operatorSteps.forEach((step) => {
        if (step.operatorIndex > maxIndex) {
          maxIndex = step.operatorIndex;
        }
        if (!labelByIndex.has(step.operatorIndex) && step.operatorName) {
          labelByIndex.set(step.operatorIndex, step.operatorName);
        }
      });
    });

    if (maxIndex < 0) {
      return ['deliver'];
    }

    const labels = Array.from({ length: maxIndex + 1 }, (_, index) =>
      labelByIndex.get(index) ?? `op${index}`
    );
    labels.push('deliver');
    return labels;
  }

  private drawDiagram() {
    const groups = this.groupedTraces();
    this.circleRegistry.clear();
    const canvases = this.diagramCanvases?.toArray() ?? [];
    const containers = this.diagramContainers?.toArray() ?? [];

    groups.forEach((group, index) => {
      const canvas = canvases[index]?.nativeElement;
      const container = containers[index]?.nativeElement;
      if (canvas && container) {
        this.drawSubscriptionDeterministic(group.subscriptionId, canvas, container, group.traces);
      }
    });
  }

  private drawSubscriptionDeterministic(
    subscriptionId: string,
    canvas: HTMLCanvasElement,
    container: HTMLDivElement,
    traces: ValueTrace[]
  ) {
    const padding = { top: 32, right: 32, bottom: 40, left: 110 };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = Math.max(600, container.clientWidth);
    const rowHeight = 36;
    const axisLabels = this.getAxisLabelsForTraces(traces);
    const operatorCount = Math.max(0, axisLabels.length - 1);

    const tracesById = new Map<string, ValueTrace>();
    const indexByValueId = new Map<string, number>();
    traces.forEach((trace, index) => {
      tracesById.set(trace.valueId, trace);
      indexByValueId.set(trace.valueId, index);
    });

    // Some operators (e.g. bufferCount) collapse multiple input traces into a single "target" trace.
    // The target trace's operator step might still show as transformed, so we infer the visual
    // "collapsed" outcome for the target when any other trace points to it via `collapsedInto`.
    //
    // We store by stroke index (operatorIndex + 1), since that's where the output circle is drawn.
    const collapsedTargetsByStroke = new Set<string>();
    traces.forEach((trace) => {
      const collapsedInto = trace.collapsedInto;
      if (!collapsedInto) return;
      collapsedTargetsByStroke.add(`${collapsedInto.targetValueId}:${collapsedInto.operatorIndex + 1}`);
    });

    const childrenByBaseId = new Map<string, number[]>();
    traces.forEach((trace, index) => {
      const expandedFrom = (trace as ValueTraceWithExpansion).expandedFrom;
      if (!expandedFrom) return;
      const list = childrenByBaseId.get(expandedFrom.baseValueId) ?? [];
      list.push(index);
      childrenByBaseId.set(expandedFrom.baseValueId, list);
    });

    const valueIdSeq = (valueId: string) => {
      const match = /(\d+)$/.exec(valueId);
      return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
    };

    childrenByBaseId.forEach((indices, baseId) => {
      const sorted = [...indices].sort((a, b) => valueIdSeq(traces[a].valueId) - valueIdSeq(traces[b].valueId));
      childrenByBaseId.set(baseId, sorted);
    });

    const orderedIndices: number[] = [];
    const rowByTraceIndex = new Map<number, number>();
    let rowCursor = 0;

    traces.forEach((trace, index) => {
      const expandedFrom = (trace as ValueTraceWithExpansion).expandedFrom;
      if (expandedFrom) return;
      if (!rowByTraceIndex.has(index)) {
        rowByTraceIndex.set(index, rowCursor++);
        orderedIndices.push(index);
      }

      const children = childrenByBaseId.get(trace.valueId) ?? [];
      children.forEach((childIndex) => {
        rowByTraceIndex.set(childIndex, rowCursor++);
        orderedIndices.push(childIndex);
      });
    });

    traces.forEach((_, index) => {
      if (rowByTraceIndex.has(index)) return;
      rowByTraceIndex.set(index, rowCursor++);
      orderedIndices.push(index);
    });

    const totalRows = orderedIndices.length;
    const height = Math.max(220, totalRows * rowHeight + padding.top + padding.bottom);
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const chartWidth = width - padding.left - padding.right;
    const strokeCount = Math.max(2, axisLabels.length);
    const columnWidth = chartWidth / (strokeCount - 1);
    const columnLabels = axisLabels.slice(0, -1);
    const getColumnCenter = (index: number) => padding.left + index * columnWidth + columnWidth / 2;
    const getStrokeX = (index: number) => padding.left + index * columnWidth;

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#fbfcfe');
    grad.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    for (let i = 0; i < axisLabels.length; i += 1) {
      const x = getStrokeX(i);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
    }

    ctx.font = '11px "Inter", sans-serif';
    ctx.fillStyle = '#475467';
    columnLabels.forEach((label, index) => {
      const x = getColumnCenter(index);
      ctx.textAlign = 'center';
      ctx.fillText(label.toUpperCase(), x, height - padding.bottom + 16);
    });

    type Point = { x: number; y: number };
    const groupCircles: CanvasCircle[] = [];
    let circleCounter = 0;
    const pointByTraceStroke = new Map<string, Map<number, Point>>();
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
      config: {
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
      x: config.x,
      y: config.y,
      radius: 6,
      label: config.label,
      value: config.value,
      operatorName: config.operatorName,
      trace,
      state,
      subscriptionId,
      isTerminal: config.isTerminal,
      hasValue: config.hasValue,
      hasStep: config.hasStep,
    });

    orderedIndices.forEach((traceIndex) => {
      const trace = traces[traceIndex];
      const row = rowByTraceIndex.get(traceIndex) ?? 0;
      const y = padding.top + row * rowHeight + rowHeight / 2;
      const stepsByIndex = new Map<number, OperatorStep>(trace.operatorSteps.map((step) => [step.operatorIndex, step]));

      const expandedFrom = (trace as ValueTraceWithExpansion).expandedFrom;

      const pointsByStroke = new Map<number, Point>();
      pointByTraceStroke.set(trace.valueId, pointsByStroke);

      let lastPoint: Point | undefined;
      let stopped = false;

      if (expandedFrom) {
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
        pointsByStroke.set(startOpIndex + 1, { x: startX, y });
        lastPoint = { x: startX, y };

        for (let opIndex = startOpIndex + 1; opIndex < operatorCount; opIndex += 1) {
          const step = stepsByIndex.get(opIndex);
          if (!step) break;

          if (trace.collapsedInto?.operatorIndex === opIndex) {
            const targetIndex = indexByValueId.get(trace.collapsedInto.targetValueId);
            if (targetIndex !== undefined) {
              const targetRow = rowByTraceIndex.get(targetIndex) ?? 0;
              const targetY = padding.top + targetRow * rowHeight + rowHeight / 2;
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
          drawCurve(lastPoint, outPoint, state);

          const isTerminal = state === 'filtered' || state === 'errored';
          const valueOut = isTerminal ? undefined : step.outputValue;
          const circleOut = makeCircle(trace, state, {
            x: outX,
            y,
            label: 'output',
            value: valueOut,
            hasValue: valueOut !== undefined,
            hasStep: true,
            operatorName: step.operatorName ?? axisLabels[opIndex],
            isTerminal,
          });
          groupCircles.push(circleOut);
          pointsByStroke.set(opIndex + 1, outPoint);
          lastPoint = outPoint;

          if (isTerminal) {
            stopped = true;
            break;
          }
        }
      } else {
        const emitX = getStrokeX(0);
        const emittedCircle = makeCircle(trace, 'emitted', {
          x: emitX,
          y,
          label: 'emit',
          value: trace.sourceValue,
          hasValue: trace.sourceValue !== undefined,
          hasStep: true,
          operatorName: 'emit',
          isTerminal: false,
        });
        groupCircles.push(emittedCircle);
        pointsByStroke.set(0, { x: emitX, y });
        lastPoint = { x: emitX, y };

        for (let opIndex = 0; opIndex < operatorCount; opIndex += 1) {
          const step = stepsByIndex.get(opIndex);
          if (!step) break;

          if (trace.collapsedInto?.operatorIndex === opIndex) {
            const targetIndex = indexByValueId.get(trace.collapsedInto.targetValueId);
            if (targetIndex !== undefined) {
              const targetRow = rowByTraceIndex.get(targetIndex) ?? 0;
              const targetY = padding.top + targetRow * rowHeight + rowHeight / 2;
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
          drawCurve(lastPoint, outPoint, state);

          const isTerminal = state === 'filtered' || state === 'errored';
          const valueOut = isTerminal ? undefined : step.outputValue;
          const circleOut = makeCircle(trace, state, {
            x: outX,
            y,
            label: 'output',
            value: valueOut,
            hasValue: valueOut !== undefined,
            hasStep: true,
            operatorName: step.operatorName ?? axisLabels[opIndex],
            isTerminal,
          });
          groupCircles.push(circleOut);
          pointsByStroke.set(opIndex + 1, outPoint);
          lastPoint = outPoint;

          if (isTerminal) {
            stopped = true;
            break;
          }
        }
      }

      if (!stopped && trace.deliveredAt && lastPoint) {
        const deliverX = getStrokeX(axisLabels.length - 1);
        const deliverPoint = { x: deliverX, y };
        drawCurve(lastPoint, deliverPoint, 'delivered');
        const deliverCircle = makeCircle(trace, 'delivered', {
          x: deliverX,
          y,
          label: 'output',
          value: trace.finalValue,
          hasValue: trace.finalValue !== undefined,
          hasStep: true,
          operatorName: 'deliver',
          isTerminal: true,
        });
        groupCircles.push(deliverCircle);
        pointsByStroke.set(axisLabels.length - 1, deliverPoint);
      }
    });

    traces.forEach((childTrace) => {
      const expandedFrom = (childTrace as ValueTraceWithExpansion).expandedFrom;
      if (!expandedFrom) return;

      const baseTrace = tracesById.get(expandedFrom.baseValueId);
      const baseIndex = baseTrace ? indexByValueId.get(baseTrace.valueId) : undefined;
      const childIndex = indexByValueId.get(childTrace.valueId);
      if (baseIndex === undefined || childIndex === undefined) return;

      const baseRow = rowByTraceIndex.get(baseIndex) ?? 0;
      const childRow = rowByTraceIndex.get(childIndex) ?? 0;
      const baseY = padding.top + baseRow * rowHeight + rowHeight / 2;
      const childY = padding.top + childRow * rowHeight + rowHeight / 2;

      const originOpIndex = expandedFrom.operatorIndex;
      const basePoint = {
        x: getStrokeX(originOpIndex),
        y: baseY,
      };
      const childPoint = {
        x: getStrokeX(originOpIndex + 1),
        y: childY,
      };

      expansionLinks.push({ from: basePoint, to: childPoint });
    });

    collapseLinks.forEach(({ from, to }) => drawCurve(from, to, 'collapsed'));
    expansionLinks.forEach(({ from, to }) => drawCurve(from, to, 'expanded'));

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

    ctx.textAlign = 'center';
    ctx.font = '12px "Inter", sans-serif';
    ctx.fillStyle = '#475467';
    ctx.fillText('Operator flow / timeline', padding.left + chartWidth / 2, padding.top - 12);
  }

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

  refreshTraces() {
    this.traceMap.clear();
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
    this.selectedTrace.set(
      this.selectedTrace()?.valueId === trace.valueId ? null : trace
    );
  }

  trackByTrace(_: number, trace: ValueTrace) {
    return trace.valueId;
  }

  formatDuration(ms: number | undefined) {
    if (!ms) {
      return '?';
    }
    if (ms < 1000) {
      return `${ms.toFixed(1)}ms`;
    }
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
    if (typeof value === 'object') return JSON.stringify(value);
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
    if (!state) {
      return '#475467';
    }
    return STATE_COLORS[state]?.accent ?? '#475467';
  }

  private handleTraceUpdate(trace: ValueTrace) {
    this.traceMap.set(trace.valueId, trace);
    const list = Array.from(this.traceMap.values()).sort((a, b) => a.emittedAt - b.emittedAt);
    this.traces.set(list);
  }
}
