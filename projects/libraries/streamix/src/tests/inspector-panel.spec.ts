import { mountStreamixInspector } from '../lib/runtime/inspector-panel';
import { __streamixPipeline, __streamixBeginLifetime, __streamixDebug, __streamixDebugDispose, enableStreamixIntrospection } from '../lib/runtime/introspection';
import { internalRuntime } from '../lib/runtime/runtime';

describe('inspector trace history', () => {
  let host: HTMLDivElement;
  let unmount: () => void;
  let pending: FrameRequestCallback | undefined;
  const metadata = (name: string) => ({ name, kind: 'source' as const, file: 'trace-test.ts', line: 1, column: 1 });
  const flush = () => { const callback = pending; pending = undefined; callback?.(0); };
  const tab = (name: string) => {
    const button = Array.from(host.querySelectorAll('nav button')).find(button => button.textContent === name) as HTMLButtonElement;
    button.click();
  };
  const trace = () => host.querySelector('[data-streamix-trace]') as HTMLDivElement;

  beforeEach(() => {
    enableStreamixIntrospection();
    pending = undefined;
    spyOn(window, 'requestAnimationFrame').and.callFake(callback => { pending = callback; return 1; });
    spyOn(window, 'cancelAnimationFrame').and.stub();
    host = document.createElement('div'); document.body.appendChild(host);
    unmount = mountStreamixInspector(host);
    tab('Trace');
  });
  afterEach(() => { unmount(); host.remove(); });

  it('appends parallel events without replacing, reordering or rewriting printed rows', () => {
    const a = __streamixDebug({}, metadata('trace-a'));
    const b = __streamixDebug({}, metadata('trace-b'));
    const payload = { count: 1 };
    internalRuntime.events.publish({ node: a, generation: 1, kind: 'next', value: payload });
    flush();
    const first = trace().lastElementChild!;
    const printed = first.textContent;
    payload.count = 99;
    __streamixDebug(a, metadata('renamed-a'));
    internalRuntime.events.publish({ node: b, generation: 2, kind: 'next', value: 'parallel-b' });
    internalRuntime.events.publish({ node: a, generation: 1, kind: 'next', value: payload });
    flush();
    expect(first.parentElement).toBe(trace());
    expect(first.textContent).toBe(printed);
    expect(printed).toMatch(/^trace-a \| emission/);
    expect(printed).toContain('emission 1');
    expect(printed).toContain('"count":1');
    expect(first.compareDocumentPosition(trace().lastElementChild!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trace().lastElementChild!.textContent).toContain('"count":99');
    tab('Atoms'); tab('Trace');
    expect(first.parentElement).toBe(trace());
    expect(first.textContent).toBe(printed);
    __streamixDebugDispose(a); __streamixDebugDispose(b);
  });

  it('prints milliseconds on each timed next event without rewriting older rows', () => {
    const source = __streamixDebug({}, metadata('pull-preview'));
    internalRuntime.events.publish({ node: source, generation: 1, kind: 'next', value: 0.3, pullMs: 16.25 });
    flush();
    const row = trace().lastElementChild as HTMLDivElement;
    const printed = row.textContent;
    expect(printed).toContain('value: 0.3 | wait: 16.25 ms');
    expect(row.title).toContain('including source waiting');
    internalRuntime.events.publish({ node: source, generation: 1, kind: 'next', value: 0.4, pullMs: 15 });
    flush();
    expect(row.textContent).toBe(printed);
    expect(trace().lastElementChild!.textContent).toContain('value: 0.4 | wait: 15.00 ms');
    __streamixDebugDispose(source);
  });

  it('shows a compact lifetime summary with extra metrics only on hover', () => {
    const operator = __streamixDebug({}, { ...metadata('timed-operator'), kind: 'operator' });
    const span = __streamixBeginLifetime(operator)!;
    span.start(); span.output(); span.finish('complete'); flush();
    const row = trace().lastElementChild as HTMLDivElement;
    expect(row.textContent).toMatch(/^timed-operator \| request 1 \| complete \| lifetime: [\d.]+ ms$/);
    expect(row.textContent).not.toContain('outputs');
    expect(row.title).toContain('outputs: 1');
    const printed = row.textContent;
    span.finish('cancel'); flush();
    expect(trace().lastElementChild).toBe(row);
    expect(row.textContent).toBe(printed);
    __streamixDebugDispose(operator);
  });

  it('hides repeated operator stages by default and can reveal the original rows', () => {
    const operator = __streamixDebug({}, { ...metadata('verbose-stage'), kind: 'operator' });
    const source = __streamixDebug({}, metadata('readable-flow'));
    internalRuntime.events.publish({ node: operator, generation: 1, kind: 'next', value: 0.174258181818181828, pullMs: 16.8 });
    const operatorRow = trace().lastElementChild as HTMLDivElement;
    internalRuntime.events.publish({ node: source, generation: 1, kind: 'next', value: 0.174258181818181828, pullMs: 16.9 });
    flush();
    const sourceRow = trace().lastElementChild as HTMLDivElement;
    expect(operatorRow.hidden).toBeTrue();
    expect(sourceRow.hidden).toBeFalse();
    expect(sourceRow.textContent).toBe('readable-flow | emission 1 | value: 0.174258 | wait: 16.90 ms');
    expect(sourceRow.title).toContain('0.17425818181818184');
    const printed = operatorRow.textContent;
    const toggle = host.querySelector('[aria-label="Show operator events"]') as HTMLInputElement;
    toggle.checked = true; toggle.dispatchEvent(new Event('change')); flush();
    expect(operatorRow.hidden).toBeFalse();
    expect(operatorRow.textContent).toBe(printed);
    expect(operatorRow.parentElement).toBe(trace());
    toggle.checked = false; toggle.dispatchEvent(new Event('change')); flush();
    expect(operatorRow.hidden).toBeTrue();
    __streamixDebugDispose(operator); __streamixDebugDispose(source);
  });

  it('shows one lifetime per flattening operator and identifies each operator in trace summaries', () => {
    const a = __streamixDebug({ name: 'switchMap' }, { ...metadata('flow.switch'), kind: 'operator', line: 10 });
    const b = __streamixDebug({ name: 'mergeMap' }, { ...metadata('flow.merge'), kind: 'operator', line: 20 });
    const node = {};
    __streamixPipeline(node, [a, b]);
    __streamixDebug(node, { ...metadata('multi-details'), kind: 'flow' });
    __streamixBeginLifetime(a)!.finish('complete');
    __streamixBeginLifetime(b)!.finish('cancel'); flush();
    const traceText = trace().textContent!;
    expect(traceText).toContain('multi-details | switchMap at 10:1 | request 1 | complete | lifetime:');
    expect(traceText).toContain('multi-details | mergeMap at 20:1 | request 1 | cancel | lifetime:');
    tab('Flows');
    const button = Array.from(host.querySelectorAll('[data-streamix-object-id]')).find(row => row.textContent!.includes('multi-details')) as HTMLButtonElement;
    button.click();
    const details = host.querySelector('pre')!.textContent!;
    expect(details).toContain('Inner lifetimes (latest finished per operator):');
    expect(details).toContain('switchMap at 10:1:');
    expect(details).toContain('mergeMap at 20:1:');
    expect(details).not.toContain('Last inner lifetime:');
    __streamixDebugDispose(node); __streamixDebugDispose(a); __streamixDebugDispose(b);
  });

  it('filters existing rows without recreating them and caps history at 250', () => {
    const source = __streamixDebug({}, metadata('retained-trace'));
    const row = trace().lastElementChild as HTMLDivElement;
    const filter = host.querySelector('input')!;
    filter.value = 'no-match'; filter.dispatchEvent(new Event('input')); flush();
    expect(row.hidden).toBeTrue();
    filter.value = ''; filter.dispatchEvent(new Event('input')); flush();
    expect(row.hidden).toBeFalse();
    expect(row.parentElement).toBe(trace());
    for (let i = 0; i < 260; i++) internalRuntime.events.publish({ node: source, generation: 1, kind: 'next', value: i });
    flush();
    expect(trace().children.length).toBe(250);
    expect(trace().firstElementChild!.textContent).toContain('value: 10');
    expect(trace().lastElementChild!.textContent).toContain('value: 259');
    __streamixDebugDispose(source);
  });
});
