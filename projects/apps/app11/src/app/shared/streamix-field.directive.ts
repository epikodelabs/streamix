import {
  Directive, ElementRef, HostListener, Input, OnChanges, OnDestroy, inject,
} from '@angular/core';
import { type Field, watchNode } from './streamix-forms';

type NativeFieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type ElementKind = 'checkbox' | 'radio' | 'number' | 'select' | 'text';

function detectKind(el: NativeFieldElement): ElementKind {
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return 'checkbox';
    if (el.type === 'radio') return 'radio';
    if (el.type === 'number' || el.type === 'range') return 'number';
  }
  return 'text';
}

@Directive({
  selector: 'input[sxField], textarea[sxField], select[sxField]',
  standalone: true,
})
export class StreamixFieldDirective implements OnChanges, OnDestroy {
  private readonly element = inject<ElementRef<NativeFieldElement>>(ElementRef);
  private stopWatching: (() => void) | undefined;
  private kind: ElementKind = 'text';

  @Input({ required: true }) sxField!: Field<unknown>;

  ngOnChanges(): void {
    this.stopWatching?.();
    this.kind = detectKind(this.element.nativeElement);
    this.stopWatching = this.sxField ? watchNode(this.sxField, () => this.render()) : undefined;
    this.render();
  }

  ngOnDestroy(): void { this.stopWatching?.(); }

  @HostListener('input') onInput(): void { if (this.usesInputEvent()) this.write(); }
  @HostListener('change') onChange(): void { if (!this.usesInputEvent()) this.write(); }
  @HostListener('blur') onBlur(): void { this.sxField.touch(); }

  private usesInputEvent(): boolean {
    return this.kind !== 'select' && this.kind !== 'checkbox' && this.kind !== 'radio';
  }

  private write(): void {
    const el = this.element.nativeElement;
    if (this.kind === 'radio' && el instanceof HTMLInputElement && !el.checked) return;
    this.sxField.set(this.readValue());
  }

  private readValue(): unknown {
    const el = this.element.nativeElement;
    if (el instanceof HTMLInputElement) {
      switch (this.kind) {
        case 'checkbox': return el.checked;
        case 'number': return el.value === '' ? null : el.valueAsNumber;
        case 'radio': return el.value;
      }
    }
    return el.value;
  }

  private render(): void {
    if (!this.sxField) return;
    const el = this.element.nativeElement;
    const value = this.sxField.completeValue.value;
    el.disabled = this.sxField.disabled.value;

    if (el instanceof HTMLInputElement) {
      if (this.kind === 'checkbox') { el.checked = Boolean(value); return; }
      if (this.kind === 'radio') { el.checked = String(value ?? '') === el.value; return; }
    }

    const rendered = value == null ? '' : String(value);
    if (el.value !== rendered) el.value = rendered;
  }
}