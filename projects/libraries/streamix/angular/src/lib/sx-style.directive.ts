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
  bindStyle,
  type DirectBinding,
} from './direct-binding';

@Directive({
  selector: '[sxStyle][sxStyleName]',
  standalone: true,
})
export class SxStyleDirective implements OnChanges, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private binding?: DirectBinding;

  @Input({ required: true })
  sxStyle: DependencySource<unknown> | null | undefined;

  @Input({ required: true })
  sxStyleName = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['sxStyle'] && !changes['sxStyleName']) {
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

    if (!this.sxStyle || !this.sxStyleName) {
      return;
    }

    this.binding = bindStyle(
      this.sxStyle,
      this.element.nativeElement,
      this.sxStyleName,
    );
  }
}
