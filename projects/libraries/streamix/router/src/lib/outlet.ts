import {
  DestroyRef,
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
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
export class StreamixOutlet implements OnInit {
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
    return this.name ?? '';
  }

  @Output() readonly activate = new EventEmitter<unknown>();
  @Output() readonly deactivate = new EventEmitter<unknown>();


  ngOnInit(): void {
    // Angular assigns regular @Input() values after construction.
    // Connecting here prevents a named outlet from being mistaken for
    // the primary outlet during directive construction.
    if (!this.router.active && this.name === '') {
      this.router.connect(this.element);
      this.connectedRoot = true;
    }
  }

  constructor() {
    const onActivate = (event: Event) =>
      this.activate.emit((event as CustomEvent<unknown>).detail);
    const onDeactivate = (event: Event) =>
      this.deactivate.emit((event as CustomEvent<unknown>).detail);

    this.element.addEventListener(OUTLET_ACTIVATE_EVENT, onActivate);
    this.element.addEventListener(OUTLET_DEACTIVATE_EVENT, onDeactivate);

    this.destroyRef.onDestroy(() => {
      this.element.removeEventListener(OUTLET_ACTIVATE_EVENT, onActivate);
      this.element.removeEventListener(OUTLET_DEACTIVATE_EVENT, onDeactivate);
      if (this.connectedRoot) {
        this.router.disconnect(this.element);
      }
    });
  }
}