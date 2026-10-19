import { streamixInspector, type StreamixObjectDetails } from './introspection';

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
  const rows = document.createElement('div');
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
    rows.replaceChildren();
    if (tab === 'Trace') {
      for (const event of streamixInspector.trace().slice(-50).reverse()) {
        if (query && !(event.name + ' ' + event.kind).toLowerCase().includes(query)) continue;
        const row = document.createElement('div'); row.textContent = event.kind + ': ' + event.name + (event.id ? ' #' + event.id : '') + ' ' + (event.error ?? event.value ?? ''); rows.appendChild(row);
      }
    } else {
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
    'State: ' + row.state + ' | value: ' + row.value + ' | subscribers: ' + row.subscribers + ' | emitted: ' + row.emitted,
    'Owner: ' + (row.owner ? describe(row.owner) : row.source.ownerClass ?? 'root'),
    ...(row.source.field ? ['Field: ' + row.source.field] : []),
    ...(row.source.enclosing ? ['Created in: ' + row.source.enclosing] : []),
    ...(row.target ? ['Subscribed to: ' + describe(row.target)] : []),
    'Dependencies: ' + (row.dependencies.map(describe).join(', ') || '-'),
    'Consumers: ' + (row.consumers.map(describe).join(', ') || '-'),
    'Composition: ' + (row.composition.length ? '' : '-'),
    ...row.composition.map(id => {
      const stage = streamixInspector.details(id);
      return '  ' + (stage ? '[' + stage.kind + '] ' + describe(id) + ' | ' + stage.state + ' | ' + stage.value +
        ' | ' + stage.source.file + ':' + stage.source.line : describe(id));
    }),
    ...row.members.map(member => '  ' + member.name + ': ' + (member.id ? streamixInspector.details(member.id)?.value ?? 'released' : member.state)),
    ...(row.error ? ['Error: ' + row.error] : []),
  ].join('\n');
  const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(render); };
  for (const title of ['Scopes', 'Atoms', 'Flows', 'Trace']) {
    const button = document.createElement('button'); button.textContent = title; button.style.marginRight = '5px';
    button.onclick = () => { tab = title; render(); }; tabs.appendChild(button);
  }
  filter.oninput = schedule; kind.onchange = schedule; related.onchange = schedule;
  content.append(tabs, filter, kind, relatedLabel, rows, detail);
  panel.append(heading, collapse, content);
  const stop = streamixInspector.observe(schedule);
  render();
  return () => { stop(); if (frame !== undefined) cancelAnimationFrame(frame); panel.remove(); };
}
