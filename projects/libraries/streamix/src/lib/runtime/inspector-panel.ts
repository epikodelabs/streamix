import { streamixInspector, type StreamixInspectionEvent, type StreamixObjectDetails } from './introspection';

/**
 * Panel styling is injected once as a stylesheet: the panel keeps its printed
 * formats (trace rows and the details block are pinned by spec), so all
 * visuals are CSS — layout, badges via child elements only where textContent
 * is not asserted, and pseudo-element/dataset decoration where it is.
 */
const STYLE = `
.sx-panel{position:fixed;right:14px;bottom:14px;z-index:99999;width:min(780px,96vw);height:64vh;max-height:64vh;display:flex;flex-direction:column;
  background:#0b1220;color:#e2e8f0;border:1px solid #253044;border-radius:12px;overflow:hidden;text-align:left;
  font:12px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  box-shadow:0 24px 64px -16px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.03) inset;
  box-sizing:border-box}
.sx-panel[data-collapsed]{width:52px;height:52px;border-radius:26px;box-shadow:0 10px 24px -8px rgba(0,0,0,.6)}
.sx-panel[data-collapsed] .sx-head{padding:0;background:none;border-bottom:0;gap:0}
.sx-panel[data-collapsed] .sx-logo,.sx-panel[data-collapsed] .sx-head strong,.sx-panel[data-collapsed] .sx-sub,.sx-panel[data-collapsed] .sx-spacer{display:none}
.sx-panel[data-collapsed] .sx-collapse{width:52px;height:52px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center;font-size:0;border-color:#2c3a52}
.sx-panel[data-collapsed] .sx-collapse::before{content:"";width:16px;height:16px;border-radius:50%;background:#22d3ee;box-shadow:0 0 10px rgba(34,211,238,.6);transition:transform .18s ease}
.sx-panel[data-collapsed] .sx-collapse:hover{border-color:#22d3ee;background:#0f1a2e}
.sx-panel[data-collapsed] .sx-collapse:hover::before{transform:scale(1.15)}
.sx-panel[data-collapsed][data-live] .sx-collapse::before{animation:sx-pulse 1.1s ease-in-out 3}
.sx-panel *,.sx-panel *::before,.sx-panel *::after{box-sizing:border-box}
.sx-panel ::-webkit-scrollbar{width:8px;height:8px}
.sx-panel ::-webkit-scrollbar-thumb{background:#2c3a52;border-radius:4px}
.sx-panel ::-webkit-scrollbar-thumb:hover{background:#3b4d6b}
.sx-panel ::-webkit-scrollbar-track{background:transparent}
.sx-head{display:flex;align-items:center;gap:8px;padding:9px 12px;background:rgba(148,163,184,.06);border-bottom:1px solid #1f2a3d;flex:none;user-select:none}
.sx-logo{width:9px;height:9px;border-radius:50%;background:#22d3ee;box-shadow:0 0 8px rgba(34,211,238,.55);flex:none}
.sx-panel[data-live] .sx-logo{animation:sx-pulse 1.1s ease-in-out 3}
@keyframes sx-pulse{50%{box-shadow:0 0 14px rgba(34,211,238,.95);transform:scale(1.3)}}
@media (prefers-reduced-motion:reduce){.sx-panel[data-live] .sx-logo{animation:none}}
.sx-head strong{font-size:12px;font-weight:650;letter-spacing:.3px;color:#f1f5f9}
.sx-sub{color:#64748b;font-size:11px}
.sx-spacer{flex:1}
.sx-collapse{background:none;border:1px solid #2c3a52;color:#94a3b8;border-radius:7px;padding:3px 10px;font:inherit;font-size:11px;cursor:pointer;transition:all .15s}
.sx-collapse:hover{color:#e2e8f0;border-color:#3b4d6b;background:rgba(148,163,184,.08)}
.sx-body{display:flex;flex-direction:column;flex:1;min-height:0}
.sx-body[hidden]{display:none}
.sx-tabs{display:flex;gap:4px;padding:8px 10px 0;flex:none}
.sx-tabs button{background:none;border:0;color:#94a3b8;font:inherit;font-size:11.5px;font-weight:550;padding:5px 12px;border-radius:7px 7px 0 0;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s}
.sx-tabs button:hover{color:#e2e8f0;background:rgba(148,163,184,.07)}
.sx-tabs button[aria-pressed="true"]{color:#22d3ee;border-bottom-color:#22d3ee;background:rgba(34,211,238,.07)}
.sx-toolbar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #1f2a3d;flex:none;flex-wrap:wrap}
.sx-filter{flex:1 1 180px;min-width:120px;background:#101a2c;border:1px solid #2c3a52;color:#e2e8f0;border-radius:7px;padding:4px 9px;font:11.5px ui-monospace,SFMono-Regular,Consolas,monospace;outline:none;transition:border-color .15s}
.sx-filter:focus{border-color:#22d3ee;box-shadow:0 0 0 2px rgba(34,211,238,.15)}
.sx-filter::placeholder{color:#475569}
.sx-toolbar select{background:#101a2c;border:1px solid #2c3a52;color:#e2e8f0;border-radius:7px;padding:4px 6px;font:inherit;font-size:11px;outline:none;cursor:pointer}
.sx-chip{display:inline-flex;align-items:center;gap:5px;background:#101a2c;border:1px solid #2c3a52;border-radius:999px;padding:3px 10px 3px 7px;font-size:11px;color:#94a3b8;cursor:pointer;transition:all .15s;user-select:none}
.sx-chip:hover{border-color:#3b4d6b;color:#e2e8f0}
.sx-chip input{accent-color:#22d3ee;margin:0;cursor:pointer}
.sx-chip[hidden]{display:none}
.sx-hint{margin:0;padding:5px 12px;color:#64748b;font-size:10.5px;border-bottom:1px solid #1f2a3d;background:rgba(148,163,184,.03);flex:none}
.sx-hint[hidden]{display:none}
.sx-main{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.sx-rows,.sx-trace{flex:1;min-width:0;min-height:0;overflow:auto}
.sx-rows[hidden],.sx-trace[hidden]{display:none}
.sx-rows.sx-empty{color:#64748b;font-style:italic;padding:16px 12px}
.sx-detail{flex:0 1 42%;min-height:0;width:100%;overflow:auto;border-top:1px solid #1f2a3d;background:rgba(2,6,17,.55);padding:10px 12px;margin:0;
  font:11px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;color:#cbd5e1;white-space:pre-wrap;overflow-wrap:anywhere}
.sx-detail[hidden]{display:none}
.sx-row,.sx-columns{display:grid;grid-template-columns:76px minmax(150px,1.6fr) 42px 110px minmax(90px,1fr) minmax(120px,1fr);align-items:center;gap:7px;width:100%;min-width:680px}
.sx-columns{position:sticky;top:0;z-index:1;padding:6px 10px;background:#101a2c;border-bottom:1px solid #253044;color:#94a3b8;font-size:10px;font-weight:650;letter-spacing:.3px}
.sx-row{text-align:left;cursor:pointer;border:0;border-bottom:1px solid rgba(148,163,184,.07);background:transparent;color:inherit;font:inherit;padding:6px 10px;transition:background .12s}
.sx-row:hover{background:rgba(34,211,238,.06)}
.sx-row[data-selected="true"]{background:rgba(34,211,238,.1);box-shadow:inset 2px 0 0 #22d3ee}
.sx-row > *{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sx-row .sx-badge,.sx-row .sx-pill{justify-self:start;max-width:100%}
.sx-row:focus-visible{outline:1px solid #22d3ee;outline-offset:-1px}
.sx-badge{flex:none;font-size:9.5px;font-weight:650;letter-spacing:.4px;text-transform:uppercase;padding:1px 6px;border-radius:5px;background:var(--sx-kind-bg,#334155);color:var(--sx-kind-fg,#cbd5e1)}
.sx-name{font-weight:560;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.sx-id{font-variant-numeric:tabular-nums;color:#475569;font-size:10.5px;flex:none}
.sx-pill{flex:none;font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(148,163,184,.12);color:#94a3b8}
.sx-pill[data-state="running"],.sx-pill[data-state="next"]{background:rgba(52,211,153,.14);color:#34d399}
.sx-pill[data-state="awaiting source"]{background:rgba(56,189,248,.13);color:#38bdf8}
.sx-pill[data-state="ready"]{background:rgba(96,165,250,.13);color:#60a5fa}
.sx-pill[data-state="idle"],.sx-pill[data-state="unevaluated"]{background:rgba(148,163,184,.1);color:#64748b}
.sx-pill[data-state="error"]{background:rgba(248,113,113,.15);color:#f87171}
.sx-value{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;color:#94a3b8}
.sx-file{flex:none;color:#475569;font-size:10px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.sx-trace-row{position:relative;padding:3px 10px 3px 24px;font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;color:#cbd5e1;border-bottom:1px solid rgba(148,163,184,.05);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sx-trace-row[hidden]{display:none}
.sx-trace-row::before{content:"";position:absolute;left:10px;top:50%;margin-top:-3px;width:6px;height:6px;border-radius:50%;background:var(--sx-dot,#475569)}
.sx-trace-row:hover{background:rgba(148,163,184,.06)}
.sx-trace-row[data-kind="next"]{--sx-dot:#34d399}
.sx-trace-row[data-kind="complete"]{--sx-dot:#60a5fa}
.sx-trace-row[data-kind="cancel"]{--sx-dot:#fbbf24}
.sx-trace-row[data-kind="error"]{--sx-dot:#f87171;background:rgba(248,113,113,.07);color:#fca5a5}
.sx-trace-row[data-kind="lifetime"]{--sx-dot:#c084fc}
.sx-trace-row[data-kind="register"]{--sx-dot:#334155}
.sx-trace-row[data-kind="dispose"]{--sx-dot:#64748b}
.sx-trace-row[data-kind="subscription"],.sx-trace-row[data-kind="unsubscribe"],.sx-trace-row[data-kind="read"],.sx-trace-row[data-kind="write"],.sx-trace-row[data-kind="render"]{--sx-dot:#38bdf8}
.sx-badge[data-kind="scope"]{--sx-kind-bg:rgba(245,158,11,.15);--sx-kind-fg:#fbbf24}
.sx-badge[data-kind="atom"]{--sx-kind-bg:rgba(96,165,250,.15);--sx-kind-fg:#93c5fd}
.sx-badge[data-kind="derived"]{--sx-kind-bg:rgba(167,139,250,.15);--sx-kind-fg:#c4b5fd}
.sx-badge[data-kind="flow"]{--sx-kind-bg:rgba(52,211,153,.15);--sx-kind-fg:#6ee7b7}
.sx-badge[data-kind="operator"]{--sx-kind-bg:rgba(244,114,182,.15);--sx-kind-fg:#f9a8d4}
.sx-badge[data-kind="source"]{--sx-kind-bg:rgba(148,163,184,.15);--sx-kind-fg:#cbd5e1}
.sx-badge[data-kind="subscription"]{--sx-kind-bg:rgba(45,212,191,.15);--sx-kind-fg:#5eead4}
`;

function ensurePanelStyle(): void {
  if (document.getElementById('streamix-inspector-style')) return;
  const style = document.createElement('style');
  style.id = 'streamix-inspector-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function spanOf(className: string, text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/** Shared imperative panel; renders outside framework change detection. */
export function mountStreamixInspector(host?: HTMLElement): () => void {
  if (typeof window === 'undefined' || !window.__streamix || !document.body) return () => {};
  if (!host && document.querySelector('[data-streamix-inspector]')) return () => {};
  ensurePanelStyle();
  const panel = document.createElement('aside');
  panel.className = 'sx-panel';
  panel.dataset['streamixInspector'] = '';
  panel.dataset['streamixDevtools'] = '';
  (host ?? document.body).appendChild(panel);
  const logo = spanOf('sx-logo', '');
  const heading = document.createElement('strong');
  heading.textContent = 'Streamix inspector';
  const subtitle = spanOf('sx-sub', '');
  const spacer = spanOf('sx-spacer', '');
  const collapse = document.createElement('button');
  collapse.className = 'sx-collapse';
  collapse.textContent = 'Collapse';
  collapse.setAttribute('aria-label', 'Collapse diagnostics');
  const head = document.createElement('header');
  head.className = 'sx-head';
  head.append(logo, heading, subtitle, spacer, collapse);
  const content = document.createElement('div');
  content.className = 'sx-body';
  // Keep the expanded layout fixed and reveal it with a compositor clip.
  // Animating width/height reflows the toolbar and scroll panes every frame.
  let morph: Animation | undefined;
  let fades: Animation[] = [];
  let collapsed = false;
  const clearPendingReveal = (): void => {
    if (morph) morph.onfinish = null;
    morph?.cancel();
    for (const fade of fades) fade.cancel();
    morph = undefined;
    fades = [];
  };
  const applyCollapsed = (): void => {
    panel.toggleAttribute('data-collapsed', collapsed);
    content.hidden = collapsed;
    collapse.textContent = collapsed ? '' : 'Collapse';
    collapse.setAttribute('aria-label', collapsed ? 'Expand diagnostics' : 'Collapse diagnostics');
    collapse.setAttribute('aria-expanded', String(!collapsed));
  };
  const setCollapsed = (next: boolean): void => {
    // Capture the visible clip before cancelling, so a reversal starts at
    // the current shape rather than jumping to either endpoint.
    const currentClip = morph ? getComputedStyle(panel).clipPath : undefined;
    const currentShadow = morph ? getComputedStyle(panel).boxShadow : undefined;
    clearPendingReveal();
    collapsed = next;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !panel.animate) {
      applyCollapsed();
      render();
      return;
    }
    panel.removeAttribute('data-collapsed');
    content.hidden = false;
    collapse.textContent = 'Collapse';
    collapse.setAttribute('aria-label', 'Collapse diagnostics');
    collapse.setAttribute('aria-expanded', String(!collapsed));
    render();
    const { width, height } = panel.getBoundingClientRect();
    const fabClip = `inset(${Math.max(0, height - 52)}px 0 0 ${Math.max(0, width - 52)}px round 26px)`;
    const openClip = 'inset(0px 0px 0px 0px round 12px)';
    // The shadow interpolates with the clip; a static swap would jump at the
    // same layout change that swaps in the FAB.
    const fabShadow = '0 10px 24px -8px rgba(0, 0, 0, 0.6)';
    const openShadow = getComputedStyle(panel).boxShadow;
    morph = panel.animate([
      { clipPath: currentClip ?? (collapsed ? openClip : fabClip), boxShadow: currentShadow ?? (collapsed ? openShadow : fabShadow) },
      { clipPath: collapsed ? fabClip : openClip, boxShadow: collapsed ? fabShadow : openShadow },
    ], { duration: 300, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' });
    // Fade within the growing shell, without a second layout/reveal phase.
    fades = [head, content].map(element => element.animate(
      collapsed ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: collapsed ? 100 : 180, delay: collapsed ? 0 : 80, fill: 'both' },
    ));
    morph.onfinish = () => {
      applyCollapsed();
      clearPendingReveal();
      // The real FAB replaces the faded shell in one layout swap; bring it in
      // softly so the dot does not pop at the end of the morph.
      if (collapsed) {
        collapse.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      }
      schedule();
    };
  };
  collapse.setAttribute('aria-expanded', 'true');
  collapse.onclick = () => setCollapsed(!collapsed);
  const tabs = document.createElement('nav');
  tabs.className = 'sx-tabs';
  let tab = 'Scopes';
  let selected: number | undefined;
  let frame: number | undefined;
  const filter = document.createElement('input');
  filter.className = 'sx-filter';
  filter.placeholder = 'Filter by name or file';
  filter.setAttribute('aria-label', 'Filter Streamix objects');
  const kind = document.createElement('select');
  kind.setAttribute('aria-label', 'Object kind');
  for (const value of ['', 'scope', 'atom', 'derived', 'flow', 'operator', 'source', 'subscription']) {
    const option = document.createElement('option'); option.value = value; option.textContent = value || 'All kinds'; kind.appendChild(option);
  }
  const related = document.createElement('input'); related.type = 'checkbox';
  const relatedLabel = document.createElement('label'); relatedLabel.className = 'sx-chip'; relatedLabel.append(related, ' Include related');
  const operatorEvents = document.createElement('input'); operatorEvents.type = 'checkbox';
  operatorEvents.setAttribute('aria-label', 'Show operator events');
  const operatorLabel = document.createElement('label'); operatorLabel.className = 'sx-chip'; operatorLabel.append(operatorEvents, ' Show operator events');
  const toolbar = document.createElement('div');
  toolbar.className = 'sx-toolbar';
  toolbar.append(filter, kind, relatedLabel, operatorLabel);
  const traceHelp = document.createElement('p');
  traceHelp.className = 'sx-hint';
  traceHelp.textContent = 'Wait includes source delay. Lifetime covers one inner execution. Stage waits overlap; do not add them.';
  const rows = document.createElement('div');
  rows.className = 'sx-rows';
  const traceRows = document.createElement('div');
  traceRows.className = 'sx-trace';
  traceRows.dataset['streamixTrace'] = '';
  let followTrace = true;
  traceRows.onscroll = () => {
    if (traceRows.hidden || content.hidden || traceRows.clientHeight === 0) return;
    followTrace = traceRows.scrollHeight - traceRows.scrollTop - traceRows.clientHeight <= 2;
  };
  const detail = document.createElement('pre');
  detail.className = 'sx-detail';
  const main = document.createElement('div');
  main.className = 'sx-main';
  main.append(rows, traceRows, detail);
  content.append(tabs, toolbar, traceHelp, main);
  panel.append(head, content);
  // Blink the header dot while events arrive, without keeping a timer per event.
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  const markLive = () => {
    panel.dataset['live'] = 'true';
    if (liveTimer !== undefined) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { delete panel.dataset['live']; }, 1200);
  };
  const traceEntries: { event: StreamixInspectionEvent; row: HTMLDivElement }[] = [];
  const appendTrace = (event: StreamixInspectionEvent) => {
    const row = document.createElement('div');
    row.className = 'sx-trace-row';
    row.dataset['kind'] = event.lifetime ? 'lifetime' : event.kind;
    // Format once from the event snapshot. Live object state never rewrites history.
    const value = event.value !== undefined && /^-?\d+\.\d{7,}$/.test(event.value)
      ? String(Number(Number(event.value).toPrecision(6))) : event.value;
    if (event.lifetime) {
      row.textContent = (event.ownerName ?? event.name) + (event.ownerName && event.operator ? ' | ' + event.operator.name + ' at ' + event.operator.line + ':' + event.operator.column : '') + ' | request ' + event.emission + ' | ' +
        event.lifetime.outcome + ' | lifetime: ' + event.lifetime.durationMs.toFixed(2) + ' ms';
    } else {
      row.textContent = (event.kind === 'next' ? event.name : event.kind + ': ' + event.name) +
        (event.emission === undefined ? '' : ' | emission ' + event.emission) +
        (event.error === undefined ? value === undefined ? '' : ' | value: ' + value : ' | error: ' + event.error) +
        (event.pullMs === undefined ? '' : ' | wait: ' + event.pullMs.toFixed(2) + ' ms');
    }
    row.title = event.name + (event.id ? ' #' + event.id : '') + (event.value === undefined ? '' : '\nFull value: ' + event.value);
    if (event.pullMs !== undefined) row.title += '\nTime awaiting next(), including source waiting; not CPU processing time.';
    if (event.lifetime) row.title += '\nQueue: ' + event.lifetime.queueMs.toFixed(2) + ' ms | first output: ' +
      (event.lifetime.firstOutputMs === undefined ? '-' : event.lifetime.firstOutputMs.toFixed(2) + ' ms') + ' | outputs: ' + event.lifetime.outputs;
    row.hidden = event.objectKind === 'operator' && !event.lifetime && !operatorEvents.checked;
    traceEntries.push({ event, row });
    traceRows.appendChild(row);
    // Match the inspector's bounded history; retained rows keep their identity.
    if (traceEntries.length > 250) traceEntries.shift()!.row.remove();
  };
  for (const event of streamixInspector.trace()) appendTrace(event);
  const describe = (id: number) => { const row = streamixInspector.details(id); return row ? row.name + ' #' + id : '#' + id + ' (released)'; };
  const render = () => {
    frame = undefined;
    if (content.hidden) return;
    const all = streamixInspector.inspect();
    const current = selected === undefined ? undefined : streamixInspector.details(selected);
    const connected = new Set(current ? [current.id, current.owner, current.target, ...current.dependencies, ...current.consumers, ...current.composition,
      ...current.members.map(member => member.id)] : []);
    const query = filter.value.toLowerCase();
    for (const button of Array.from(tabs.querySelectorAll('button'))) button.setAttribute('aria-pressed', String(button.textContent === tab));
    const list = all.filter(row => (related.checked && connected.has(row.id)) || ((!kind.value || row.kind === kind.value) &&
      (!query || (row.name + ' ' + row.source.file).toLowerCase().includes(query)) &&
      (tab === 'Scopes' ? row.kind === 'scope'
        : tab === 'Atoms' ? ['atom', 'derived'].includes(row.kind) : !row.pipedSource && (row.kind === 'flow' || row.kind === 'source' || row.pipeline))));
    rows.hidden = tab === 'Trace';
    traceRows.hidden = tab !== 'Trace';
    detail.hidden = tab === 'Trace' || selected === undefined;
    traceHelp.hidden = operatorLabel.hidden = tab !== 'Trace';
    kind.hidden = relatedLabel.hidden = tab === 'Trace';
    filter.placeholder = tab === 'Trace' ? 'Filter trace by name or event' : 'Filter by name or file';
    subtitle.textContent = tab === 'Trace' ? traceEntries.length + ' events' : all.length + ' live objects';
    if (tab === 'Trace') {
      for (const { event, row } of traceEntries) {
        row.hidden = (event.objectKind === 'operator' && !event.lifetime && !operatorEvents.checked) ||
          (!!query && !(event.name + ' ' + (event.ownerName ?? '') + ' ' + event.kind).toLowerCase().includes(query));
      }
      if (followTrace) traceRows.scrollTop = traceRows.scrollHeight;
    } else {
      rows.replaceChildren();
      rows.classList.toggle('sx-empty', !list.length);
      if (!list.length) rows.textContent = 'No matching live objects.';
      else {
        const columns = document.createElement('div');
        columns.className = 'sx-columns';
        columns.setAttribute('aria-hidden', 'true');
        for (const label of ['Kind', 'Name', 'ID', 'State', 'Value', 'Source']) {
          columns.appendChild(spanOf('', label));
        }
        rows.appendChild(columns);
      }
      for (const row of list) {
        const button = document.createElement('button');
        button.dataset['streamixObjectId'] = String(row.id);
        button.className = 'sx-row';
        button.dataset['selected'] = String(row.id === selected);
        const badge = spanOf('sx-badge', row.pipeline ? 'pipe' : row.kind);
        badge.dataset['kind'] = row.kind;
        const pill = spanOf('sx-pill', row.state);
        pill.dataset['state'] = row.state.toLowerCase();
        const file = row.source.file.split('/').pop() ?? row.source.file;
        button.append(badge, spanOf('sx-name', row.name), spanOf('sx-id', '#' + row.id), pill,
          spanOf('sx-value', row.value), spanOf('sx-file', file + ':' + row.source.line));
        button.title = row.name + ' #' + row.id + ' | ' + row.state + ' | ' + row.value + ' | ' + file + ':' + row.source.line;
        button.onclick = () => { selected = row.id; render(); };
        rows.appendChild(button);
      }
    }
    detail.textContent = current ? formatDetails(current) : selected === undefined ? 'Select an object for details. Console: __streamix.inspect()' : 'Selected object was disposed. Its terminal event remains in Trace.';
  };
  const formatDetails = (row: StreamixObjectDetails) => [
    row.name + ' #' + row.id + ' [' + row.kind + '] at ' + row.source.file + ':' + row.source.line + ':' + row.source.column,
    'State: ' + row.state + ' | value: ' + row.value + ' | subscribers: ' + row.subscribers,
    'Emissions: ' + row.metrics.total,
    ...(row.innerLifetimes.length ? ['Inner lifetimes (latest finished per operator):',
      ...row.innerLifetimes.map(({ operator, lifetime }) => '  ' + operator.name + ' at ' + operator.line + ':' + operator.column +
        ': ' + lifetime.durationMs.toFixed(2) + ' ms (' + lifetime.outcome + ')')] : []),
    'Errors: ' + row.metrics.errors + ' | completed: ' + row.metrics.completed + ' | cancelled: ' + row.metrics.cancelled,
    'Owner: ' + (row.owner ? describe(row.owner) : row.source.ownerClass ?? 'root'),
    ...(row.source.field ? ['Field: ' + row.source.field] : []),
    ...(row.source.enclosing ? ['Created in: ' + row.source.enclosing] : []),
    ...(row.target ? ['Subscribed to: ' + describe(row.target)] : []),
    'Dependencies: ' + (row.dependencies.map(describe).join(', ') || '-'),
    'Consumers: ' + (row.consumers.map(describe).join(', ') || '-'),
    ...row.members.map(member => '  ' + member.name + ': ' + (member.id ? streamixInspector.details(member.id)?.value ?? 'released' : member.state)),
    ...(row.error ? ['Error: ' + row.error] : []),
  ].join('\n');
  const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(render); };
  for (const title of ['Scopes', 'Atoms', 'Flows', 'Trace']) {
    const button = document.createElement('button'); button.textContent = title; button.onclick = () => { if (title === 'Trace' && tab !== title) followTrace = true; tab = title; render(); }; tabs.appendChild(button);
  }
  filter.oninput = schedule; kind.onchange = schedule; related.onchange = schedule; operatorEvents.onchange = schedule;
  const stop = streamixInspector.observe(event => { appendTrace(event); markLive(); schedule(); });
  render();
  return () => {
    stop();
    clearPendingReveal();
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (liveTimer !== undefined) clearTimeout(liveTimer);
    panel.remove();
  };
}
