import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';

import { createStreamixFormDemo } from '../../shared/streamix-form.helpers';

@Component({
  standalone: true,
  templateUrl: './streamix-form.page.html',
  styleUrl: './streamix-form.page.scss',
})
export class StreamixFormPageComponent implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);

  readonly demo = createStreamixFormDemo(() => this.cdr.detectChanges());

  ngOnDestroy(): void {
    this.demo.dispose();
  }
}
