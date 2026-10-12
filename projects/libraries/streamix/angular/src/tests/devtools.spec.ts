import { TestBed } from '@angular/core/testing';
import { atom } from '@epikodelabs/streamix';
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
  it('records subscription, write, and unsubscribe for table bindings', async () => {
    const source = atom('Ready');
    const table = new SxBindingTable(1);

    table.bind(0, source, () => undefined, undefined, 'status');
    source.next('Saved');
    table.flushNow();
    await flushMicrotasks();

    const trace = streamixDevtoolsSnapshot().map(event => `${event.type}: ${event.source}`);
    expect(trace).toContain('subscription: status');
    expect(trace).toContain('write: status');
    expect(trace).toContain('render: 1 binding');

    table.destroy();
    await flushMicrotasks();
    expect(streamixDevtoolsSnapshot().map(event => `${event.type}: ${event.source}`))
      .toContain('unsubscribe: status');
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
    expect(panel!.textContent).toContain('write: panel');
  });
});
