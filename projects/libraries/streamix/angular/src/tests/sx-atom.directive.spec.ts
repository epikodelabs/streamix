import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { atom } from '@epikodelabs/streamix';

import { SxAtomDirective } from '../lib/sx-atom.directive';


import {
  ensureAngularTestEnvironment,
} from './angular-test-environment';

ensureAngularTestEnvironment();

idescribe('SxAtomDirective', () => {
  it('renders the initial scalar value synchronously', () => {
    @Component({
      standalone: true,
      imports: [SxAtomDirective],
      template: '<span *sxAtom="count as value">{{ value }}</span>',
    })
    class HostComponent {
      readonly count = atom(1);
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('1');
  });

  it('supports keyed collection microsyntax', () => {
    @Component({
      standalone: true,
      imports: [SxAtomDirective],
      template: `
        <span *sxAtom="let item of items; trackBy: trackItem">
          {{ item.name }}
        </span>
      `,
    })
    class HostComponent {
      readonly items = atom([
        { id: 1, name: 'one' },
        { id: 2, name: 'two' },
      ]);

      readonly trackItem = (_index: number, item: { id: number }) => item.id;
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('span') as NodeListOf<HTMLSpanElement>,
        node => node.textContent?.trim(),
      ),
    ).toEqual(['one', 'two']);
  });
});
import { idescribe } from '../../../src/tests/env.spec';
