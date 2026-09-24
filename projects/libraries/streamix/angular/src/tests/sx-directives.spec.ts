import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { atom } from '@epikodelabs/streamix';

import { SxAttrDirective } from '../lib/sx-attr.directive';
import { SxClassDirective } from '../lib/sx-class.directive';
import { SxPropDirective } from '../lib/sx-prop.directive';
import { SxStyleDirective } from '../lib/sx-style.directive';


import {
  ensureAngularTestEnvironment,
} from './angular-test-environment';

ensureAngularTestEnvironment();

idescribe('sx direct directives', () => {
  @Component({
    standalone: true,
    imports: [
      SxAttrDirective,
      SxClassDirective,
      SxPropDirective,
      SxStyleDirective,
    ],
    template: `
      <input [sxProp]="value" sxPropName="value">
      <div
        [sxAttr]="role"
        sxAttrName="role"
        [sxClass]="active"
        sxClassName="active"
        [sxStyle]="width"
        sxStyleName="width">
      </div>
    `,
  })
  class HostComponent {
    readonly value = atom('hello');
    readonly role = atom<unknown>('button');
    readonly active = atom(false);
    readonly width = atom<unknown>('10px');
  }

  it('performs initial writes synchronously', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const div = fixture.nativeElement.querySelector('div') as HTMLDivElement;

    expect(input.value).toBe('hello');
    expect(div.getAttribute('role')).toBe('button');
    expect(div.classList.contains('active')).toBeFalse();
    expect(div.style.width).toBe('10px');
  });
});
import { idescribe } from '../../../src/tests/env.spec';
