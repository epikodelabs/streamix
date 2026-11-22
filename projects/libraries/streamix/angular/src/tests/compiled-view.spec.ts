import {
  Component,
} from '@angular/core';
import {
  TestBed,
} from '@angular/core/testing';
import { atom, createSubscription, scope, waitForDisposal } from '@epikodelabs/streamix';

import {
  createBindingTable,
  rendererScheduler,
  ɵinstallSxCompiledView,
  ɵinstallSxSourceReferences,
} from '../lib';


import { idescribe } from '../../../src/tests/env.spec';
import {
  ensureAngularTestEnvironment,
  useAngularTestEnvironment,
} from './angular-test-environment';

ensureAngularTestEnvironment();

idescribe('ɵinstallSxCompiledView', () => {
  useAngularTestEnvironment();
  it('awaits binding and owned scope teardown after Angular destroys the view', async () => {
    const bindingStopped = Promise.withResolvers<void>();
    const scopeStopped = Promise.withResolvers<void>();
    const releaseBinding = Promise.withResolvers<void>();
    const releaseScope = Promise.withResolvers<void>();
    const source = atom(1);
    const subscribe = source.subscribe.bind(source);
    spyOn(source, 'subscribe').and.callFake(callback => {
      const stop = subscribe(callback);
      return createSubscription(async () => {
        await stop();
        bindingStopped.resolve();
        await releaseBinding.promise;
      });
    });
    @Component({ template: '<span></span>' })
    class AsyncDisposalComponent {
      readonly state = scope({});
      readonly handle = ɵinstallSxCompiledView(this, () => {
        const table = createBindingTable(1);
        table.bind(0, source, () => {});
        return table;
      }, { ownedScopes: () => [this.state] });

      constructor() {
        this.state.cleanups.add(async () => { scopeStopped.resolve(); await releaseScope.promise; });
      }
    }
    const fixture = TestBed.createComponent(AsyncDisposalComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const instance = fixture.componentInstance;
    fixture.destroy();
    const disposal = instance.handle.dispose();
    expect(instance.handle.dispose()).toBe(disposal);
    const tracked = waitForDisposal(instance);
    let done = false;
    void tracked.then(() => { done = true; });
    await Promise.all([bindingStopped.promise, scopeStopped.promise]);
    releaseBinding.resolve();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(done).toBeFalse();
    expect(source.subscriberCount).toBe(0);
    expect(instance.state._disposed).toBeTrue();
    releaseScope.resolve();
    await Promise.all([tracked, disposal]);
    expect(done).toBeTrue();
    await source.dispose();
  });

  it('reports a rejected source-reference teardown when the view is destroyed', async () => {
    const failure = new Error('unsubscribe failed');
    const report = spyOn(console, 'error');
    @Component({ template: '<span></span>' })
    class Host {
      constructor() {
        ɵinstallSxCompiledView(this, () => createBindingTable(0), {
          sourceReferences: {
            source: { subscribe: () => createSubscription(async () => { throw failure; }) },
          },
        });
      }
    }
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.destroy();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(report).toHaveBeenCalledWith(jasmine.stringMatching(/teardown failed/), failure);
  });
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

  it('disposes component-owned scopes with the component', async () => {
    @Component({
      standalone: true,
      template: '<span></span>',
    })
    class HostComponent {
      readonly state = scope({ count: 0 });
      readonly disposable = {
        disposed: 0,
        dispose(): void {
          this.disposed += 1;
        },
      };

      constructor() {
        ɵinstallSxCompiledView(this, undefined, {
          ownedScopes: () => [this.state, this.disposable, undefined],
        });
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const state = component.state as unknown as { _disposed: boolean };
    expect(state._disposed).toBeFalse();
    expect(component.disposable.disposed).toBe(0);

    fixture.destroy();

    // Binding teardown and scope disposal are independent: the component had
    // no compiled setup, but its owned instances still release.
    expect(state._disposed).toBeTrue();
    expect(component.disposable.disposed).toBe(1);
  });

  it('rebinds a replaced plain source field without Angular change detection', async () => {
    @Component({
      standalone: true,
      template: '<span></span>',
    })
    class HostComponent {
      source = atom('first');
      readonly replacement = atom('second');
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
