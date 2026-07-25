import {
  AfterViewInit,
  Directive,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';

import { bindForm, type FormDomBinding } from './bind-form';
import type { Form } from './forms';

@Directive({
  selector: '[sxFormBinding]',
  standalone: true,
})
export class StreamixFormBindingDirective
  implements AfterViewInit, OnChanges, OnDestroy
{
  @Input({ required: true })
  sxFormBinding!: Form<any>;

  private readonly element =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private binding?: FormDomBinding;
  private initialized = false;

  ngAfterViewInit(): void {
    this.initialized = true;
    this.connect();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['sxFormBinding'];

    if (
      this.initialized &&
      change &&
      !Object.is(change.previousValue, change.currentValue)
    ) {
      this.connect();
    }
  }

  ngOnDestroy(): void {
    this.binding?.dispose();
    this.binding = undefined;
  }

  private connect(): void {
    this.binding?.dispose();
    this.binding = undefined;

    if (!this.sxFormBinding) {
      return;
    }

    this.binding = bindForm(
      this.element,
      this.sxFormBinding,
    );
  }
}