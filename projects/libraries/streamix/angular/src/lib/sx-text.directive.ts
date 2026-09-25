import {
  Directive,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';
import type { DependencySource } from '@epikodelabs/streamix';

import { ɵinstallSxAngularZone } from './angular-zone';
import {
  bindText,
  type DirectBinding,
} from './direct-binding';

/**
 * Direct text-content binding.
 *
 * ```html
 * <span [sx.text]="count"></span>
 * ```
 */
@Directive({
  selector: '[sx\\.text]',
  standalone: true,
})
export class SxTextDirective implements OnChanges, OnDestroy {
  constructor() {
    ɵinstallSxAngularZone();
  }

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private binding?: DirectBinding;

  @Input({ alias: 'sx.text', required: true })
  sxText: DependencySource<unknown> | null | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['sxText']) {
      return;
    }

    this.binding?.destroy();
    this.binding = undefined;

    if (!this.sxText) {
      this.element.nativeElement.textContent = '';
      return;
    }

    this.binding = bindText(this.sxText, this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.binding?.destroy();
    this.binding = undefined;
  }
}
