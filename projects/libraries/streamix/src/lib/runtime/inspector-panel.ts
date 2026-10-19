import { streamixInspector, type StreamixInspectionEvent, type StreamixObjectDetails } from './introspection';

/** Shared imperative panel; renders outside framework change detection. */
export function mountStreamixInspector(host?: HTMLElement): () => void {
  if (typeof window === 'undefined' || !window.__streamix || !document.body) return () => {};
  if (!host && document.querySelector('[data-streamix-inspector]')) return () => {};
  const panel = document.createElement('aside');
  panel.dataset['streamixInspector'] = '';
  panel.dataset['streamixDevtools'] = '';
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;width:min(700px,95vw);max-height:55vh;overflow:auto;background:#111827;color:#e5e7eb;padding:12px;border:1px solid #475569;border-radius:8px;font:12px/1.5 monospace;text-align:left;box-shadow:0 8px 30px #0005';
  (host ?? document.body).appendChild(panel);
  const heading = document.createElement('strong');
  heading.textContent = 'Streamix inspector';
  const collapse = document.createElement('button');
  collapse.textContent = 'Collapse';
  collapse.style.marginLeft = '12px';
  const content = document.createElement('div');
  collapse.onclick = () => { content.hidden = !content.hidden; collapse.textContent = content.hidden ? 'Expand' : 'Collapse'; if (!content.hidden) schedule(); };
  const tabs = document.createElement('nav');
  let tab = 'Scopes';
  let selected: number | undefined;
  let frame: number | undefined;
  const filter = document.createElement('input');
  filter.placeholder = 'Filter by name or file';
  filter.setAttribute('aria-label', 'Filter Streamix objects');
  filter.style.cssText = 'width:65%;margin:8px 0;color:#111827';
  const kind = document.createElement('select');
  kind.setAttribute('aria-label', 'Object kind');
  for (const value of ['', 'scope', 'atom', 'derived', 'flow', 'operator', 'source', 'subscription']) {
    const option = document.createElement('option'); option.value = value; option.textContent = value || 'All kinds'; kind.appendChild(option);
  }
  const related = document.createElement('input'); related.type = 'checkbox';
  const relatedLabel = document.createElement('label'); relatedLabel.append(related, ' Include related');
  const operatorEvents = document.createElement('input'); operatorEvents.type = 'checkbox';
  operatorEvents.setAttribute('aria-label', 'Show operator events');
  const operatorLabel = document.createElement('label'); operatorLabel.append(operatorEvents, ' Show operator events');
  const traceHelp = document.createElement('p');
  traceHelp.textContent = 'Wait includes source delay. Lifetime covers one inner execution. Stage waits overlap; do not add them.';
  traceHelp.style.cssText = 'color:#94a3b8;margin:6px 0';
  const rows = document.createElement('div');
  const traceRows = document.createElement('div');
  traceRows.dataset['streamixTrace'] = '';
  const traceEntries: { event: StreamixInspectionEvent; row: HTMLDivElement }[] = [];
  const appendTrace = (event: StreamixInspectionEvent) => {
    const row = document.createElement('div');
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
  const detail = document.createElement('pre'); detail.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0';
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
        : tab === 'Atoms' ? ['atom', 'derived'].includes(row.kind) : row.kind === 'flow')));
    rows.hidden = tab === 'Trace';
    traceRows.hidden = tab !== 'Trace';
    detail.hidden = tab === 'Trace';
    traceHelp.hidden = operatorLabel.hidden = tab !== 'Trace';
    kind.hidden = relatedLabel.hidden = tab === 'Trace';
    filter.placeholder = tab === 'Trace' ? 'Filter trace by name or event' : 'Filter by name or file';
    if (tab === 'Trace') {
      for (const { event, row } of traceEntries) {
        row.hidden = (event.objectKind === 'operator' && !event.lifetime && !operatorEvents.checked) ||
          (!!query && !(event.name + ' ' + (event.ownerName ?? '') + ' ' + event.kind).toLowerCase().includes(query));
      }
    } else {
      rows.replaceChildren();
      if (!list.length) rows.textContent = 'No matching live objects.';
      for (const row of list) {
        const button = document.createElement('button');
        button.dataset['streamixObjectId'] = String(row.id);
        button.style.cssText = 'display:block;width:100%;text-align:left;cursor:pointer;border:0;border-bottom:1px solid #334155;background:transparent;color:inherit;padding:5px';
        button.textContent = '[' + row.kind + '] ' + row.name + ' #' + row.id + ' | ' + row.state + ' | ' + row.value + ' | ' + row.source.file.split('/').pop() + ':' + row.source.line;
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
    const button = document.createElement('button'); button.textContent = title; button.style.marginRight = '5px';
    button.onclick = () => { tab = title; render(); }; tabs.appendChild(button);
  }
  filter.oninput = schedule; kind.onchange = schedule; related.onchange = schedule; operatorEvents.onchange = schedule;
  content.append(tabs, filter, kind, relatedLabel, operatorLabel, traceHelp, rows, traceRows, detail);
  panel.append(heading, collapse, content);
  const stop = streamixInspector.observe(event => { appendTrace(event); schedule(); });
  render();
  return () => { stop(); if (frame !== undefined) cancelAnimationFrame(frame); panel.remove(); };
}
