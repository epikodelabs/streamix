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
  bindAttribute,
  type DirectBinding,
} from './direct-binding';

@Directive({
  selector: '[sxAttr][sxAttrName]',
  standalone: true,
})
export class SxAttrDirective implements OnChanges, OnDestroy {
  private readonly element = inject<ElementRef<Element>>(ElementRef);
  private binding?: DirectBinding;

  @Input({ required: true })
  sxAttr: DependencySource<unknown> | null | undefined;

  @Input({ required: true })
  sxAttrName = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['sxAttr'] && !changes['sxAttrName']) {
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

    if (!this.sxAttr || !this.sxAttrName) {
      return;
    }

    this.binding = bindAttribute(
      this.sxAttr,
      this.element.nativeElement,
      this.sxAttrName,
    );
  }
}
