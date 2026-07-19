import {
  Directive,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  inject,
} from '@angular/core';

import {
  type Field,
  watchNode,
} from './streamix-forms';

type NativeFieldElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

/**
 * Binds a native input directly to a Streamix field.
 *
 * Usage:
 *   <input [sxField]="profile.firstName">
 *   <input type="number" [sxField]="skill.years">
 *   <input type="checkbox" [sxField]="preferences.newsletter">
 */
@Directive({
  selector: 'input[sxField], textarea[sxField], select[sxField]',
  standalone: true,
})
export class StreamixFieldDirective implements OnChanges, OnDestroy {
  private readonly element =
    inject<ElementRef<NativeFieldElement>>(ElementRef);

  private stopWatching: (() => void) | undefined;

  @Input({ required: true })
  sxField!: Field<unknown>;

  ngOnChanges(): void {
    this.stopWatching?.();
    this.stopWatching = this.sxField
      ? watchNode(this.sxField, () => this.render())
      : undefined;

    this.render();
  }

  ngOnDestroy(): void {
    this.stopWatching?.();
  }

  @HostListener('input')
  onInput(): void {
    if (this.usesChangeEvent()) return;
    this.write();
  }

  @HostListener('change')
  onChange(): void {
    if (!this.usesChangeEvent()) return;
    this.write();
  }

  @HostListener('blur')
  onBlur(): void {
    this.sxField.touch();
  }

  private write(): void {
    const element = this.element.nativeElement;

    if (
      element instanceof HTMLInputElement
      && element.type === 'radio'
      && !element.checked
    ) {
      return;
    }

    this.sxField.set(this.readValue());
  }

  private readValue(): unknown {
    const element = this.element.nativeElement;

    if (element instanceof HTMLInputElement) {
      switch (element.type) {
        case 'checkbox':
          return element.checked;

        case 'number':
        case 'range':
          return element.value === '' ? null : element.valueAsNumber;

        case 'radio':
          return element.value;
      }
    }

    return element.value;
  }

  private render(): void {
    if (!this.sxField) return;

    const element = this.element.nativeElement;
    const value = this.sxField.completeValue.value;

    element.disabled = this.sxField.disabled.value;

    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox') {
        element.checked = Boolean(value);
        return;
      }

      if (element.type === 'radio') {
        element.checked = String(value ?? '') === element.value;
        return;
      }
    }

    const rendered = value == null ? '' : String(value);
    if (element.value !== rendered) {
      element.value = rendered;
    }
  }

  private usesChangeEvent(): boolean {
    const element = this.element.nativeElement;

    return element instanceof HTMLSelectElement
      || (
        element instanceof HTMLInputElement
        && (element.type === 'checkbox' || element.type === 'radio')
      );
  }
}
