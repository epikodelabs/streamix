import { coroutine } from '@epikodelabs/streamix/coroutines';
import type { OperatorStep, ValueState, ValueTrace } from '@epikodelabs/streamix/tracing';

export interface DrawingInput {
  traces: ValueTrace[];
  axisLabels: string[];
  canvasWidth: number;
  canvasHeight: number;
  devicePixelRatio?: number;
  padding: { top: number; left: number; right: number; bottom: number };
  subscriptionId: string;
  chronologicalIndexMap: Record<string, number>;
}

export interface DrawingOutput {
  imageBitmap: ImageBitmap;
  circles: DrawingCircle[];
  totalWidth: number;
  totalHeight: number;
}

export interface DrawingCircle {
  id: string;
  x: number;
  y: number;
  row: number;
  column: number;
  operatorIndex: number | null;
  sequence: number;
  displayValueId: string;
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

interface Point {
  x: number;
  y: number;
}

export const drawingWorker = coroutine(async function renderDiagram(input: DrawingInput): Promise<DrawingOutput> {
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

  const { traces, axisLabels, canvasWidth, canvasHeight, padding, subscriptionId, chronologicalIndexMap } = input;
  const dpr = input.devicePixelRatio && input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;

  const columnCount = axisLabels.length;
  const rowCount = traces.length;
  const operatorCount = Math.max(0, axisLabels.length - 1); // excludes deliver column

  if (rowCount === 0 || columnCount === 0) {
    const emptyCanvas = new OffscreenCanvas(1, 1);
    const emptyBitmap = emptyCanvas.transferToImageBitmap ? emptyCanvas.transferToImageBitmap() : await createImageBitmap(emptyCanvas);
    return {
      imageBitmap: emptyBitmap,
      circles: [],
      totalWidth: canvasWidth,
      totalHeight: canvasHeight,
    };
  }

  const rowHeight = 36;
  const chartWidth = canvasWidth - padding.left - padding.right;
  const chartHeight = rowCount * rowHeight;
  const totalHeight = Math.max(canvasHeight, chartHeight + padding.top + padding.bottom);

  const offscreen = new OffscreenCanvas(Math.max(1, Math.floor(canvasWidth * dpr)), Math.max(1, Math.floor(totalHeight * dpr)));
  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    throw new Error('OffscreenCanvas 2D context not available');
  }
  
  ctx.scale(dpr, dpr);

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, totalHeight);
  grad.addColorStop(0, '#fbfcfe');
  grad.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvasWidth, totalHeight);

  const columnSpacing = (columnCount - 1) > 0 ? chartWidth / (columnCount - 1) : chartWidth;
  const getStrokeX = (col: number) => padding.left + col * columnSpacing;
  const getColumnCenter = (i: number) => padding.left + i * columnSpacing + columnSpacing / 2;

  // Grid
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = 1;
  for (let i = 0; i < columnCount; i += 1) {
    const x = getStrokeX(i);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, totalHeight - padding.bottom);
    ctx.stroke();
  }

  // Labels
  ctx.font = '11px "Inter", sans-serif';
  ctx.fillStyle = '#475467';
  ctx.textAlign = 'center';
  axisLabels.slice(0, -1).forEach((label, i) => {
    ctx.fillText(label.toUpperCase(), getColumnCenter(i), totalHeight - padding.bottom + 16);
  });

  const circles: DrawingCircle[] = [];
  let circleCounter = 0;
  const indexByValueId = new Map<string, number>();
  traces.forEach((t, i) => indexByValueId.set(t.valueId, i));

  const collapsedTargetsByStroke = new Set<string>();
  traces.forEach((trace) => {
    const c = trace.collapsedInto;
    if (!c) return;
    collapsedTargetsByStroke.add(`${c.targetValueId}:${c.operatorIndex + 1}`);
  });

  const collapseLinks: Array<{ from: Point; to: Point }> = [];
  const expansionLinks: Array<{ from: Point; to: Point }> = [];

  const drawCurve = (from: Point, to: Point, state: ValueState) => {
    const accent = STATE_COLORS[state]?.accent ?? STATE_COLORS.emitted.accent;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);

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

  const drawDottedHalfLine = (from: Point, to: Point, state: ValueState) => {
    const accent = STATE_COLORS[state]?.accent ?? STATE_COLORS.emitted.accent;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.setLineDash([4, 4]);

    const midX = from.x + (to.x - from.x) * 0.5;
    const midY = from.y + (to.y - from.y) * 0.5;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(midX, midY);
    ctx.stroke();

    ctx.setLineDash([]);
  };

  const drawTerminalSymbol = (x: number, y: number, state: ValueState) => {
    const accent = STATE_COLORS[state]?.accent ?? STATE_COLORS.emitted.accent;

    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    if (state === 'filtered' || state === 'errored') {
      ctx.moveTo(x - 4, y - 4);
      ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4);
      ctx.lineTo(x - 4, y + 4);
    } else if (state === 'dropped') {
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 2);
      ctx.moveTo(x - 3, y - 1);
      ctx.lineTo(x, y + 2);
      ctx.lineTo(x + 3, y - 1);
    }

    ctx.stroke();
  };

  const drawDeliveredSymbol = (from: Point, to: Point, y: number) => {
    const accent = STATE_COLORS.delivered.accent;
    const midX = from.x + (to.x - from.x) * 0.5;

    ctx.beginPath();
    ctx.arc(midX, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(midX - 3, y);
    ctx.lineTo(midX - 1, y + 3);
    ctx.lineTo(midX + 4, y - 2);
    ctx.stroke();
  };

  const getChronologicalSequence = (trace: ValueTrace, operatorIndex: number | null, label: 'emit' | 'output'): number => {
    const traceIndex = chronologicalIndexMap[trace.valueId] ?? 0;
    let sequence = (traceIndex + 1) * 1000;
    if (label === 'emit') {
      return sequence;
    }
    if (operatorIndex !== null) {
      sequence += operatorIndex + 1;
    }
    return sequence;
  };

  const makeCircle = (
    trace: ValueTrace,
    state: ValueState,
    cfg: {
      x: number;
      y: number;
      row: number;
      column: number;
      operatorIndex: number | null;
      label: 'emit' | 'output';
      value?: any;
      hasValue: boolean;
      hasStep: boolean;
      operatorName: string;
      isTerminal: boolean;
    }
  ): DrawingCircle => {
    const effectiveState: ValueState = cfg.label === 'output' && Boolean(trace.deliveredAt) ? 'delivered' : state;
    const id = `${subscriptionId}:${circleCounter++}`;
    const sequence = getChronologicalSequence(trace, cfg.operatorIndex, cfg.label);

    return {
      id,
      x: cfg.x,
      y: cfg.y,
      row: cfg.row,
      column: cfg.column,
      operatorIndex: cfg.operatorIndex,
      sequence,
      displayValueId: `val_${sequence}`,
      radius: 6,
      label: cfg.label,
      value: cfg.value,
      operatorName: cfg.operatorName,
      trace,
      state: effectiveState,
      subscriptionId,
      isTerminal: cfg.isTerminal,
      hasValue: cfg.hasValue,
      hasStep: cfg.hasStep,
    };
  };

  // Render traces (one row per trace, chronological order)
  traces.forEach((trace, row) => {
    const y = padding.top + row * rowHeight + rowHeight / 2;

    const stepsByIndex = new Map<number, OperatorStep>();
    (trace.operatorSteps ?? []).forEach((s) => stepsByIndex.set(s.operatorIndex, s));

    const expandedFrom = (trace as any).expandedFrom as
      | { operatorIndex: number; operatorName: string; baseValueId: string }
      | undefined;

    let lastPoint: Point | undefined;
    let stopped = false;

    if (expandedFrom) {
      const startOpIndex = expandedFrom.operatorIndex;
      const startX = getStrokeX(startOpIndex + 1);
      const startStep = stepsByIndex.get(startOpIndex);
      const value = startStep?.outputValue ?? trace.finalValue;

      circles.push(
        makeCircle(trace, 'expanded', {
          x: startX,
          y,
          row,
          column: startOpIndex + 1,
          operatorIndex: startOpIndex,
          label: 'output',
          value,
          hasValue: value !== undefined,
          hasStep: true,
          operatorName: expandedFrom.operatorName,
          isTerminal: false,
        })
      );

      lastPoint = { x: startX, y };

      for (let opIndex = startOpIndex + 1; opIndex < operatorCount; opIndex += 1) {
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
          state !== 'dropped' &&
          collapsedTargetsByStroke.has(`${trace.valueId}:${opIndex + 1}`)
        ) {
          state = 'collapsed';
        }

        const outX = getStrokeX(opIndex + 1);
        const isTerminal = state === 'filtered' || state === 'errored' || state === 'dropped';

        if (lastPoint) {
          if (isTerminal) {
            drawDottedHalfLine(lastPoint, { x: outX, y }, state);
            const midX = lastPoint.x + (outX - lastPoint.x) * 0.5;
            drawTerminalSymbol(midX, y, state);
          } else {
            drawCurve(lastPoint, { x: outX, y }, state);
          }
        }

        const valueOut = isTerminal ? undefined : step.outputValue;

        if (!isTerminal) {
          circles.push(
            makeCircle(trace, state, {
              x: outX,
              y,
              row,
              column: opIndex + 1,
              operatorIndex: opIndex,
              label: 'output',
              value: valueOut,
              hasValue: valueOut !== undefined,
              hasStep: true,
              operatorName: step.operatorName ?? axisLabels[opIndex],
              isTerminal: false,
            })
          );
        }

        lastPoint = { x: outX, y };
        if (isTerminal) {
          stopped = true;
          break;
        }
      }
    } else {
      const emitX = getStrokeX(0);
      circles.push(
        makeCircle(trace, 'emitted', {
          x: emitX,
          y,
          row,
          column: 0,
          operatorIndex: null,
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
          state !== 'dropped' &&
          collapsedTargetsByStroke.has(`${trace.valueId}:${opIndex + 1}`)
        ) {
          state = 'collapsed';
        }

        const outX = getStrokeX(opIndex + 1);
        const isTerminal = state === 'filtered' || state === 'errored' || state === 'dropped';

        if (lastPoint) {
          if (isTerminal) {
            drawDottedHalfLine(lastPoint, { x: outX, y }, state);
            const midX = lastPoint.x + (outX - lastPoint.x) * 0.5;
            drawTerminalSymbol(midX, y, state);
          } else {
            drawCurve(lastPoint, { x: outX, y }, state);
          }
        }

        const valueOut = isTerminal ? undefined : step.outputValue;

        if (!isTerminal) {
          circles.push(
            makeCircle(trace, state, {
              x: outX,
              y,
              row,
              column: opIndex + 1,
              operatorIndex: opIndex,
              label: 'output',
              value: valueOut,
              hasValue: valueOut !== undefined,
              hasStep: true,
              operatorName: step.operatorName ?? axisLabels[opIndex],
              isTerminal: false,
            })
          );
        }

        lastPoint = { x: outX, y };
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
      drawDeliveredSymbol(lastPoint, deliverPoint, y);

      circles.push(
        makeCircle(trace, 'delivered', {
          x: deliverX,
          y,
          row,
          column: axisLabels.length - 1,
          operatorIndex: null,
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

  traces.forEach((child) => {
    const ex = (child as any).expandedFrom as
      | { operatorIndex: number; operatorName: string; baseValueId: string }
      | undefined;
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

  collapseLinks.forEach(({ from, to }) => drawCurve(from, to, 'collapsed'));
  expansionLinks.forEach(({ from, to }) => drawCurve(from, to, 'expanded'));

  circles.forEach((circle) => {
    const circleColor = STATE_COLORS[circle.state] ?? STATE_COLORS.emitted;

    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);

    if (!circle.hasStep) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
    } else if (circle.isTerminal) {
      if (circle.state === 'delivered') {
        ctx.fillStyle = circleColor.accent;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
      } else {
        return;
      }
    } else {
      ctx.fillStyle = circle.hasValue ? '#fff' : '#f8fafc';
      ctx.strokeStyle = circleColor.accent;
      ctx.lineWidth = 2;
    }

    ctx.fill();
    ctx.stroke();
  });

  ctx.textAlign = 'center';
  ctx.font = '12px "Inter", sans-serif';
  ctx.fillStyle = '#475467';
  ctx.fillText('Operator flow / timeline', padding.left + chartWidth / 2, padding.top - 12);

  let imageBitmap: ImageBitmap;
  if (typeof (offscreen as any).transferToImageBitmap === 'function') {
    imageBitmap = (offscreen as any).transferToImageBitmap();
  } else {
    const blob = await offscreen.convertToBlob();
    imageBitmap = await createImageBitmap(blob);
  }

  return {
    imageBitmap,
    circles,
    totalWidth: canvasWidth,
    totalHeight,
  };
});
