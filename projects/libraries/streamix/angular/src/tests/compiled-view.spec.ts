import {
  Component,
} from '@angular/core';
import {
  TestBed,
} from '@angular/core/testing';

import {
  createBindingTable,
  ɵinstallSxCompiledView,
} from '../lib';


import {
  ensureAngularTestEnvironment,
} from './angular-test-environment';

ensureAngularTestEnvironment();

idescribe('ɵinstallSxCompiledView', () => {
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
import { idescribe } from '../../../src/tests/env.spec';
