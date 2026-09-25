import {
  Component,
} from '@angular/core';
import {
  TestBed,
} from '@angular/core/testing';

import {
  createBindingTable,
  rendererScheduler,
  ɵinstallSxCompiledView,
  ɵinstallSxSourceReferences,
} from '../lib';


import { idescribe } from '../../../src/tests/env.spec';
import {
  ensureAngularTestEnvironment,
} from './angular-test-environment';

ensureAngularTestEnvironment();

idescribe('ɵinstallSxCompiledView', () => {
  useAngularTestEnvironment();
  it('can be invoked from a component injection context', async () => {
    let setups = 0;

    @Component({
      standalone: true,
      template: '<span></span>',
    })
    class HostComponent {
      constructor() {
        ɵinstallSxCompiledView(
          this,
          () => {
            setups += 1;
            return createBindingTable(0);
          },
        );
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(setups).toBeLessThanOrEqual(1);

    fixture.destroy();
  });

  it('destroys the setup teardown handle with the component', async () => {
    let destroyed = 0;

    @Component({
      standalone: true,
      template: '<span></span>',
    })
    class HostComponent {
      constructor() {
        ɵinstallSxCompiledView(
          this,
          () => ({
            destroy: () => {
              destroyed += 1;
            },
          }),
        );
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(destroyed).toBe(0);

    fixture.destroy();

    expect(destroyed).toBe(1);
  });

  it('rebinds a replaced plain source field without Angular change detection', async () => {
    @Component({
      standalone: true,
      template: '<span></span>',
    })
    class HostComponent {
      source = new TestSource('first');
      readonly replacement = new TestSource('second');
      readonly __sxRefs = ɵinstallSxSourceReferences(this, ['source']);

      constructor() {
        ɵinstallSxCompiledView(
          this,
          (host, context) => {
            const table = createBindingTable(1);
            const span = host.querySelector('span')!;

            table.bind(
              0,
              context.source,
              value => {
                span.textContent = value;
              },
            );

            return table;
          },
          {
            sourceReferences: this.__sxRefs,
          },
        );
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const first = component.source;
    const second = component.replacement;
    const span = fixture.nativeElement.querySelector('span') as HTMLSpanElement;

    expect(span.textContent).toBe('first');
    expect(first.subscriberCount).toBe(1);
    expect(second.subscriberCount).toBe(0);

    // Queue work from the old source, then replace the source identity through
    // a plain assignment. No signal, markForCheck(), detectChanges(), or event
    // is involved in the rebind path.
    first.set('stale');
    component.source = second;

    expect(span.textContent).toBe('second');
    expect(first.subscriberCount).toBe(0);
    expect(second.subscriberCount).toBe(1);

    rendererScheduler.flushNow();
    expect(span.textContent).toBe('second');

    first.set('ignored');
    rendererScheduler.flushNow();
    expect(span.textContent).toBe('second');

    second.set('third');
    rendererScheduler.flushNow();
    expect(span.textContent).toBe('third');

    fixture.destroy();
    expect(second.subscriberCount).toBe(0);
  });

  it('skips setup when the component is destroyed before the first render', async () => {
    let setups = 0;

    @Component({
      standalone: true,
      template: '<span></span>',
    })
    class HostComponent {
      constructor() {
        ɵinstallSxCompiledView(
          this,
          () => {
            setups += 1;
            return createBindingTable(0);
          },
        );
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.destroy();
    await fixture.whenStable();

    expect(setups).toBe(0);
  });
});

