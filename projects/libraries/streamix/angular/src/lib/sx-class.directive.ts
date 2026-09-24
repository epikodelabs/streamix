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
  bindClass,
  type DirectBinding,
} from './direct-binding';

@Directive({
  selector: '[sxClass][sxClassName]',
  standalone: true,
})
export class SxClassDirective implements OnChanges, OnDestroy {
  private readonly element = inject<ElementRef<Element>>(ElementRef);
  private binding?: DirectBinding;

  @Input({ required: true })
  sxClass: DependencySource<unknown> | null | undefined;

  @Input({ required: true })
  sxClassName = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['sxClass'] && !changes['sxClassName']) {
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

    if (!this.sxClass || !this.sxClassName) {
      return;
    }

    this.binding = bindClass(
      this.sxClass,
      this.element.nativeElement,
      this.sxClassName,
    );
  }
}
