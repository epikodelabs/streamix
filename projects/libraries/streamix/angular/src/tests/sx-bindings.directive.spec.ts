import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { atom } from '@epikodelabs/streamix';

import {
  SxAttributeBindingsDirective,
  SxClassBindingsDirective,
  SxPropertyBindingsDirective,
  SxStyleBindingsDirective,
} from '../lib/sx-bindings.directive';
import { useAngularTestEnvironment } from './angular-test-environment';
import { idescribe } from '../../../src/tests/env.spec';
import { SxTextDirective } from '../lib/sx-text.directive';

idescribe('sx dotted binding syntax', () => {
  useAngularTestEnvironment();
  @Component({
    standalone: true,
    imports: [
      SxAttributeBindingsDirective,
      SxClassBindingsDirective,
      SxPropertyBindingsDirective,
      SxStyleBindingsDirective,
      SxTextDirective,
    ],
    template: `
      <span [sx.text]="count"></span>

      <input [sx.value]="name">

      <button
        [sx.disabled]="disabled"
        [sx.attr.aria-label]="label"
        [sx.class.active]="active"
        [sx.style.opacity]="opacity">
        Save
      </button>
    `,
  })
  class HostComponent {
    readonly count = atom(1);
    readonly name = atom('Oleksii');
    readonly disabled = atom(false);
    readonly label = atom<unknown>('Save');
    readonly active = atom(false);
    readonly opacity = atom<unknown>('1');
  }

  it('renders initial values through the dotted public API', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const span = fixture.nativeElement.querySelector('span') as HTMLSpanElement;
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(span.textContent).toBe('1');
    expect(input.value).toBe('Oleksii');
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-label')).toBe('Save');
    expect(button.classList.contains('active')).toBeFalse();
    expect(button.style.opacity).toBe('1');
  });
});
