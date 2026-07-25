import {
  Directive,
  Input,
  OnChanges,
  OnDestroy,
} from "@angular/core";
import {
  type Check,
  type Form,
  type FormCompleteValue,
} from "@epikodelabs/streamix/forms";

export interface ValidationRegistration<TValidation> {
  update(validation: TValidation): void;
  revalidate(): void;
  dispose(): void;
}

@Directive({
  selector: "[sxFormNode]",
  standalone: true,
})
export class StreamixFormDirective
  implements OnChanges, OnDestroy {
  private attachedForm?: Form<any>;
  private readonly checkSources = new Map<
    object,
    Check<FormCompleteValue<any>> | readonly Check<FormCompleteValue<any>>[]
  >();

  @Input({ required: true })
  sxFormNode!: Form<any>;

  ngOnChanges(): void {
    this.detachForm();
    this.attachForm();
  }

  ngOnDestroy(): void {
    this.detachForm();
  }

  addValidator(
    initial:
      | Check<FormCompleteValue<any>>
      | readonly Check<FormCompleteValue<any>>[],
  ): ValidationRegistration<
    | Check<FormCompleteValue<any>>
    | readonly Check<FormCompleteValue<any>>[]
  > {
    const source = {};
    let current = initial;
    let disposed = false;

    this.checkSources.set(source, current);
    this.applyValidator(source, current);

    return {
      update: validation => {
        if (disposed) return;
        current = validation;
        this.checkSources.set(source, current);
        this.applyValidator(source, current);
      },

      revalidate: () => {
        if (disposed) return;
        this.applyValidator(source, current);
      },

      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.checkSources.delete(source);

        if (
          this.attachedForm &&
          !this.attachedForm.state.disposed
        ) {
          this.attachedForm.clearChecks(source);
        }
      },
    };
  }

  private attachForm(): void {
    if (!this.sxFormNode) return;

    this.attachedForm = this.sxFormNode;

    for (const [source, validation] of this.checkSources) {
      this.applyValidator(source, validation);
    }
  }

  private detachForm(): void {
    if (
      this.attachedForm &&
      !this.attachedForm.state.disposed
    ) {
      for (const source of this.checkSources.keys()) {
        this.attachedForm.clearChecks(source);
      }
    }

    this.attachedForm = undefined;
  }

  private applyValidator(
    source: object,
    validation:
      | Check<FormCompleteValue<any>>
      | readonly Check<FormCompleteValue<any>>[],
  ): void {
    if (!this.attachedForm || this.attachedForm.state.disposed) {
      return;
    }

    this.attachedForm.useChecks(source, validation);
  }
}
