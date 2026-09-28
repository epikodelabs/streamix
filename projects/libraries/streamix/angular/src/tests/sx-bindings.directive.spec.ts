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

      <div class="class-map static" [sx.class]="classes"></div>
      <div class="style-map" style="color: red" [sx.style]="styles"></div>

      <input
        [sx.value]="name"
        [sx.placeholder]="placeholder"
        [sx.required]="required">

      <button
        [sx.disabled]="disabled"
        [sx.attr.aria-label]="label"
        [sx.attr.aria-expanded]="ariaExpanded"
        [sx.class.active]="active"
        [sx.class.visible]="visible"
        [sx.style.opacity]="opacity"
        [sx.style.transform]="transform"
        [sx.style.transformOrigin]="transformOrigin"
        [sx.style.maxWidth]="maxWidth">
        Save
      </button>
    `,
  })
  class HostComponent {
    readonly count = atom(1);
    readonly classes = atom<Record<string, unknown>>({ ready: true, stale: false });
    readonly styles = atom<Record<string, unknown>>({
      transform: 'scale(0.75)',
      transformOrigin: 'center center',
    });
    readonly name = atom('Oleksii');
    readonly placeholder = atom('Your name');
    readonly required = atom(true);
    readonly disabled = atom(false);
    readonly label = atom<unknown>('Save');
    readonly ariaExpanded = atom<unknown>('false');
    readonly active = atom(false);
    readonly visible = atom(true);
    readonly opacity = atom<unknown>('1');
    readonly transform = atom<unknown>('translateY(2px)');
    readonly transformOrigin = atom<unknown>('top center');
    readonly maxWidth = atom<unknown>('240px');
  }

  it('renders maps and the curated dotted binding surface through one import', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const span = fixture.nativeElement.querySelector('span') as HTMLSpanElement;
    const classMap = fixture.nativeElement.querySelector('.class-map') as HTMLDivElement;
    const styleMap = fixture.nativeElement.querySelector('.style-map') as HTMLDivElement;
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(span.textContent).toBe('1');

    expect(classMap.classList.contains('static')).toBeTrue();
    expect(classMap.classList.contains('ready')).toBeTrue();
    expect(classMap.classList.contains('stale')).toBeFalse();

    expect(styleMap.style.transform).toBe('scale(0.75)');
    expect(styleMap.style.transformOrigin).toBe('center center');
    expect(styleMap.style.color).toBe('red');

    expect(input.value).toBe('Oleksii');
    expect(input.placeholder).toBe('Your name');
    expect(input.required).toBeTrue();

    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-label')).toBe('Save');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.classList.contains('active')).toBeFalse();
    expect(button.classList.contains('visible')).toBeTrue();
    expect(button.style.opacity).toBe('1');
    expect(button.style.transform).toBe('translateY(2px)');
    expect(button.style.transformOrigin).toBe('center top');
    expect(button.style.maxWidth).toBe('240px');
  });

  it('writes reactive emissions without another Angular change-detection pass', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.count.set(2);
    component.name.set('Streamix');
    component.placeholder.set('Updated');
    component.required.set(false);
    component.disabled.set(true);
    component.label.set('Updated');
    component.ariaExpanded.set('true');
    component.active.set(true);
    component.visible.set(false);
    component.opacity.set('0.5');
    component.transform.set('translateY(6px)');
    component.transformOrigin.set('bottom center');
    component.maxWidth.set('320px');

    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    const span = fixture.nativeElement.querySelector('span') as HTMLSpanElement;
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(span.textContent).toBe('2');
    expect(input.value).toBe('Streamix');
    expect(input.placeholder).toBe('Updated');
    expect(input.required).toBeFalse();
    expect(button.disabled).toBeTrue();
    expect(button.getAttribute('aria-label')).toBe('Updated');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.classList.contains('active')).toBeTrue();
    expect(button.classList.contains('visible')).toBeFalse();
    expect(button.style.opacity).toBe('0.5');
    expect(button.style.transform).toBe('translateY(6px)');
    expect(button.style.transformOrigin).toBe('center bottom');
    expect(button.style.maxWidth).toBe('320px');
  });

  it('diffs dynamic class maps and preserves unrelated classes', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement.querySelector('.class-map') as HTMLDivElement;
    fixture.componentInstance.classes.set({ fresh: true, ready: false });

    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    expect(element.classList.contains('static')).toBeTrue();
    expect(element.classList.contains('ready')).toBeFalse();
    expect(element.classList.contains('stale')).toBeFalse();
    expect(element.classList.contains('fresh')).toBeTrue();
  });

  it('diffs dynamic style maps and preserves unrelated inline styles', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement.querySelector('.style-map') as HTMLDivElement;
    fixture.componentInstance.styles.set({ transform: 'scale(0.5)' });

    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    expect(element.style.transform).toBe('scale(0.5)');
    expect(element.style.transformOrigin).toBe('');
    expect(element.style.color).toBe('red');
  });

  it('unsubscribes every direct binding when the host is destroyed', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const sources = [
      component.count,
      component.classes,
      component.styles,
      component.name,
      component.placeholder,
      component.required,
      component.disabled,
      component.label,
      component.ariaExpanded,
      component.active,
      component.visible,
      component.opacity,
      component.transform,
      component.transformOrigin,
      component.maxWidth,
    ];

    for (const source of sources) {
      expect(source.subscriberCount).toBe(1);
    }

    fixture.destroy();

    for (const source of sources) {
      expect(source.subscriberCount).toBe(0);
    }
  });
});
