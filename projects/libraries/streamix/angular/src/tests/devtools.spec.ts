import { useAngularTestEnvironment } from './angular-test-environment';
import { TestBed } from '@angular/core/testing';
import { atom, derived, __streamixDebug } from '@epikodelabs/streamix';
import { enableStreamixIntrospection } from '@epikodelabs/streamix/introspection';
import { SxBindingTable } from '../lib/binding-table';
import {
  recordStreamixDevtoolsEvent,
  streamixDevtoolsSnapshot,
  StreamixDevtools,
} from '../lib/devtools';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Angular devtools', () => {
  useAngularTestEnvironment();
  it('renders live introspection without evaluating unused formulas and updates on animation frames', async () => {
    enableStreamixIntrospection();
    let evaluations = 0;
    const count = __streamixDebug(atom(0), { name: 'inspector.count', kind: 'atom', file: 'src/panel.ts', line: 1, column: 1 });
    const lazy = __streamixDebug(derived(() => { evaluations++; return 7; }),
      { name: 'inspector.lazy', kind: 'derived', file: 'src/panel.ts', line: 2, column: 1 });
    const fixture = TestBed.createComponent(StreamixDevtools);
    try {
      const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-streamix-inspector]')!;
      // The overlay mounts collapsed by default; this spec asserts the panel body.
      (panel.querySelector('.sx-collapse') as HTMLButtonElement).click();
      Array.from(panel.querySelectorAll('button')).find(button => button.textContent === 'Atoms')!.click();
      expect(panel.textContent).toContain('inspector.lazy');
      expect(evaluations).toBe(0);
      count.set(2);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      expect(panel.textContent).toContain('inspector.count');
      // The list row is structured spans: read state and value from their own columns.
      const row = Array.from(panel.querySelectorAll('[data-streamix-object-id]'))
        .find(button => button.textContent!.includes('inspector.count'))!;
      expect(row.querySelector('.sx-pill')!.textContent).toBe('ready');
      expect(row.querySelector('.sx-value')!.textContent).toBe('2');
      expect(evaluations).toBe(0);
    } finally { fixture.destroy(); count.dispose(); lazy.dispose(); }
  });
  it('records subscription, write, and unsubscribe for table bindings', async () => {
    const source = atom('Ready');
    const table = new SxBindingTable(1);

    table.bind(0, source, () => undefined, undefined, 'status');
    source.next('Saved');
    table.flushNow();
    await flushMicrotasks();

    const trace = streamixDevtoolsSnapshot().map(event => `${event.type}: ${event.source}`);
    expect(trace).toContain('subscription: template binding status');
    expect(trace).toContain('write: template binding status');
    expect(trace).toContain('render: 1 binding');

    table.destroy();
    await flushMicrotasks();
    expect(streamixDevtoolsSnapshot().map(event => `${event.type}: ${event.source}`))
      .toContain('unsubscribe: template binding status');
  });

  it('renders an opt-in panel outside change detection', async () => {
    recordStreamixDevtoolsEvent({ type: 'write', source: 'panel' });
    await flushMicrotasks();

    const fixture = TestBed.createComponent(StreamixDevtools);
    // The template is empty; the panel DOM is built imperatively in the
    // constructor, so this detectChanges pass is only Angular bookkeeping.
    fixture.detectChanges();

    const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-streamix-devtools]');
    expect(panel).not.toBeNull();
    if (typeof window !== 'undefined' && window.__streamix) {
      const trace = Array.from(panel!.querySelectorAll('button')).find(button => button.textContent === 'Trace');
      trace!.click();
    }
    expect(panel!.textContent).toContain('write: panel');
  });
});
