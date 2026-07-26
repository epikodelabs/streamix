import {
  DestroyRef,
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';

import {
  OUTLET_ACTIVATE_EVENT,
  OUTLET_ATTRIBUTE,
  OUTLET_DEACTIVATE_EVENT,
} from './router-events';
import { StreamixRouter } from './streamix-router';

@Directive({
  selector: 'streamix-outlet',
  standalone: true,
  host: {
    // Empty string = primary outlet. Any other value = named outlet.
    [`[attr.${OUTLET_ATTRIBUTE}]`]: 'outletName',
  },
})
export class StreamixOutlet {
  private readonly router = inject(StreamixRouter);
  private readonly element = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  private connectedRoot = false;

  /**
   * Optional outlet name.
   * - omitted / empty → primary outlet (used by hierarchical layouts)
   * - any string → named secondary outlet
   */
  @Input() name = '';

  /** Used by the host binding */
  get outletName(): string {
    return this.name || '';
  }

  @Output() readonly activate = new EventEmitter<unknown>();
  @Output() readonly deactivate = new EventEmitter<unknown>();

  constructor() {
    const onActivate = (event: Event) =>
      this.activate.emit((event as CustomEvent<unknown>).detail);
    const onDeactivate = (event: Event) =>
      this.deactivate.emit((event as CustomEvent<unknown>).detail);

    this.element.addEventListener(OUTLET_ACTIVATE_EVENT, onActivate);
    this.element.addEventListener(OUTLET_DEACTIVATE_EVENT, onDeactivate);

    // Only the primary (unnamed) outlet connects the router
    if (!this.router.active && !this.name) {
      this.router.connect(this.element);
      this.connectedRoot = true;
    }

    this.destroyRef.onDestroy(() => {
      this.element.removeEventListener(OUTLET_ACTIVATE_EVENT, onActivate);
      this.element.removeEventListener(OUTLET_DEACTIVATE_EVENT, onDeactivate);
      if (this.connectedRoot) {
        this.router.disconnect(this.element);
      }
    });
  }
}