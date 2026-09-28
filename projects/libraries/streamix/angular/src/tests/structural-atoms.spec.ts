import {
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';
import {
  CommonModule,
} from '@angular/common';
import {
  TestBed,
} from '@angular/core/testing';
import {
  scope,
} from '@epikodelabs/streamix';

import {
  createBindingTable,
  rendererScheduler,
  ɵinstallSxCompiledView,
  ɵsxInvalidate,
} from '../lib';
import {
  ensureAngularTestEnvironment,
  useAngularTestEnvironment,
} from './angular-test-environment';

ensureAngularTestEnvironment();

describe('compiler-linked structural atoms', () => {
  useAngularTestEnvironment();

  it('refreshes native and classic structural blocks from scoped atoms', async () => {
    @Component({
      standalone: true,
      imports: [CommonModule],
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `
        @if (model.refs.ready.value) {
          <p class="message">{{ model.refs.message.value }}</p>
        }
        <li class="item" *ngFor="let item of model.refs.items.value">{{ item }}</li>
        <section [ngSwitch]="model.refs.status.value">
          <span *ngSwitchCase="'ready'">ready</span>
          <span *ngSwitchDefault>waiting</span>
        </section>
      `,
    })
    class HostComponent {
      readonly model = scope({
        ready: false,
        message: 'first',
        items: ['one'],
        status: 'waiting',
      });

      constructor() {
        ɵinstallSxCompiledView(this, (_host, context, invalidate) => {
          const table = createBindingTable(1);
          ɵsxInvalidate(table, 0, [
            context.model.refs.ready,
            context.model.refs.message,
            context.model.refs.items,
            context.model.refs.status,
          ], invalidate ?? (() => {}));
          return table;
        }, { angularInvalidation: true });
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;
    expect(host.querySelector('.message')).toBeNull();
    expect(host.querySelectorAll('.item').length).toBe(1);
    expect(host.textContent).toContain('waiting');

    component.model.ready = true;
    component.model.message = 'updated';
    component.model.items = ['one', 'two'];
    component.model.status = 'ready';
    rendererScheduler.flushNow();

    expect(host.querySelector('.message')?.textContent).toBe('updated');
    expect(Array.from(host.querySelectorAll('.item')).map(item => item.textContent))
      .toEqual(['one', 'two']);
    expect(host.textContent).toContain('ready');
    expect(host.textContent).not.toContain('waiting');

    fixture.destroy();
  });
});
