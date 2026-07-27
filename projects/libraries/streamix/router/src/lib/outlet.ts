import {
  DestroyRef,
  Directive,
  ElementRef,
  Input,
  OnInit,
  inject,
} from '@angular/core';

import { StreamixRouter } from './streamix-router';

@Directive({ selector: 'streamix-outlet', standalone: true })
export class StreamixOutlet implements OnInit {
  private readonly router = inject(StreamixRouter);
  private readonly element = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly destroyRef = inject(DestroyRef);

  @Input() name = '';

  ngOnInit(): void {
    this.router.connect(this.name, this.element);
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.router.disconnect(this.name, this.element);
    });
  }
}