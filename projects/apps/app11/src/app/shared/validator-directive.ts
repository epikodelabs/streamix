import {
  Directive,
  Input,
  OnChanges,
  OnDestroy,
  inject,
} from "@angular/core";
import {
  type Check,
  type FieldValidationSource,
  type FormCompleteValue,
  type ValidationIssues,
} from "@epikodelabs/streamix/forms";
import { StreamixFieldDirective } from "./streamix-field.directive";
import { StreamixFormDirective } from "./streamix-form.directive";

type MaybePromise<T> = T | PromiseLike<T>;

@Directive()
export abstract class MarkerFieldValidatorDirective
  implements OnDestroy {
  protected readonly field = inject(StreamixFieldDirective);
  private readonly registration =
    this.field.addValidation(this.validation());

  protected abstract validation(): FieldValidationSource<unknown>;

  ngOnDestroy(): void {
    this.registration.dispose();
  }
}

@Directive()
export abstract class ConfiguredFieldValidatorDirective<TConfig>
  implements OnChanges, OnDestroy {
  protected readonly field = inject(StreamixFieldDirective);
  private readonly registration =
    this.field.addValidation({});

  protected abstract inputAlias(): string;
  protected abstract validation(config: TConfig): FieldValidationSource<unknown>;

  @Input()
  config!: TConfig;

  ngOnChanges(): void {
    this.registration.update(this.validation(this.config));
    this.registration.revalidate();
  }

  ngOnDestroy(): void {
    this.registration.dispose();
  }
}

@Directive()
export abstract class MarkerFormValidatorDirective
  implements OnDestroy {
  protected readonly form = inject(StreamixFormDirective);
  private readonly registration =
    this.form.addValidator(this.validator());

  protected abstract validator(): Check<FormCompleteValue<any>>;

  ngOnDestroy(): void {
    this.registration.dispose();
  }
}

@Directive()
export abstract class ConfiguredFormValidatorDirective<TConfig>
  implements OnChanges, OnDestroy {
  protected readonly form = inject(StreamixFormDirective);
  private readonly registration =
    this.form.addValidator(() => null);

  protected abstract validator(config: TConfig): Check<FormCompleteValue<any>>;

  @Input()
  config!: TConfig;

  ngOnChanges(): void {
    this.registration.update(this.validator(this.config));
    this.registration.revalidate();
  }

  ngOnDestroy(): void {
    this.registration.dispose();
  }
}

export function syncFieldValidation<TValue>(
  validate: (value: TValue) => ValidationIssues | null,
): FieldValidationSource<unknown> {
  return {
    checks: value => validate(value as TValue),
  };
}

export function asyncFieldValidation<TValue>(
  validate: (
    value: TValue,
    signal: AbortSignal,
  ) => MaybePromise<ValidationIssues | null>,
  options: {
    asyncDelay?: number;
    asyncOnlyWhenSyncClean?: boolean;
  } = {},
): FieldValidationSource<unknown> {
  return {
    asyncChecks: (value, signal) =>
      validate(value as TValue, signal),
    asyncDelay: options.asyncDelay,
    asyncOnlyWhenSyncClean: options.asyncOnlyWhenSyncClean,
  };
}
