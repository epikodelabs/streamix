import {
  DestroyRef,
  Directive,
  ElementRef,
  EventEmitter,
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
    [`[attr.${OUTLET_ATTRIBUTE}]`]: '""',
  },
})
export class StreamixOutlet {
  private readonly router = inject(StreamixRouter);
  private readonly element = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  private connectedRoot = false;

  @Output() readonly activate = new EventEmitter<unknown>();
  @Output() readonly deactivate = new EventEmitter<unknown>();

  constructor() {
    const onActivate = (event: Event) =>
      this.activate.emit((event as CustomEvent<unknown>).detail);
    const onDeactivate = (event: Event) =>
      this.deactivate.emit((event as CustomEvent<unknown>).detail);

    this.element.addEventListener(OUTLET_ACTIVATE_EVENT, onActivate);
    this.element.addEventListener(OUTLET_DEACTIVATE_EVENT, onDeactivate);
    if (!this.router.active) {
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