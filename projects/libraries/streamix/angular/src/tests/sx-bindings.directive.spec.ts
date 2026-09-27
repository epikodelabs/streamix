import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { atom } from '@epikodelabs/streamix';

import { SxBindingsDirective } from '../lib/sx-bindings.directive';
import { useAngularTestEnvironment } from './angular-test-environment';
import { idescribe } from '../../../src/tests/env.spec';

idescribe('SxBindingsDirective', () => {
  useAngularTestEnvironment();

  @Component({
    standalone: true,
    imports: [SxBindingsDirective],
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

  it('renders all dotted binding families through one directive import', () => {
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

  it('writes reactive emissions without another Angular change-detection pass', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.count.set(2);
    component.name.set('Streamix');
    component.disabled.set(true);
    component.label.set('Updated');
    component.active.set(true);
    component.opacity.set('0.5');

    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    const span = fixture.nativeElement.querySelector('span') as HTMLSpanElement;
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(span.textContent).toBe('2');
    expect(input.value).toBe('Streamix');
    expect(button.disabled).toBeTrue();
    expect(button.getAttribute('aria-label')).toBe('Updated');
    expect(button.classList.contains('active')).toBeTrue();
    expect(button.style.opacity).toBe('0.5');
  });

  it('unsubscribes every direct binding when the host is destroyed', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.count.subscriberCount).toBe(1);
    expect(component.name.subscriberCount).toBe(1);
    expect(component.disabled.subscriberCount).toBe(1);
    expect(component.label.subscriberCount).toBe(1);
    expect(component.active.subscriberCount).toBe(1);
    expect(component.opacity.subscriberCount).toBe(1);

    fixture.destroy();

    expect(component.count.subscriberCount).toBe(0);
    expect(component.name.subscriberCount).toBe(0);
    expect(component.disabled.subscriberCount).toBe(0);
    expect(component.label.subscriberCount).toBe(0);
    expect(component.active.subscriberCount).toBe(0);
    expect(component.opacity.subscriberCount).toBe(0);
  });
});
