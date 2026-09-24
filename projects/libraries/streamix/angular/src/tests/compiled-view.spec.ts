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
});
import { idescribe } from '../../../src/tests/env.spec';
