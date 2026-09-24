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

import {
  bindProperty,
  type DirectBinding,
} from './direct-binding';

/**
 * Direct property binding.
 *
 * @example
 * ```html
 * <input [sxProp]="value" sxPropName="value">
 * ```
 */
@Directive({
  selector: '[sxProp][sxPropName]',
  standalone: true,
})
export class SxPropDirective implements OnChanges, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private binding?: DirectBinding;

  @Input({ required: true })
  sxProp: DependencySource<unknown> | null | undefined;

  @Input({ required: true })
  sxPropName = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['sxProp'] && !changes['sxPropName']) {
      return;
    }

    this.rebind();
  }

  ngOnDestroy(): void {
    this.binding?.destroy();
    this.binding = undefined;
  }

  private rebind(): void {
    this.binding?.destroy();
    this.binding = undefined;

    if (!this.sxProp || !this.sxPropName) {
      return;
    }

    this.binding = bindProperty(
      this.sxProp,
      this.element.nativeElement,
      this.sxPropName,
    );
  }
}
