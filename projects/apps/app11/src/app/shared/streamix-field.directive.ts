import {
  ChangeDetectorRef,
  Directive,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  inject,
} from "@angular/core";
import {
  checks,
  formatFieldError,
  type Check,
  type Field,
  type FieldValidationSource,
  watchNode,
} from "@epikodelabs/streamix/forms";

type NativeFieldElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

type ElementKind =
  | "checkbox"
  | "radio"
  | "number"
  | "select"
  | "text";

export interface ValidationRegistration<TValidation> {
  update(validation: TValidation): void;
  revalidate(): void;
  dispose(): void;
}

function detectKind(
  element: NativeFieldElement,
): ElementKind {
  if (element instanceof HTMLSelectElement) {
    return "select";
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return "checkbox";
    if (element.type === "radio") return "radio";

    if (
      element.type === "number" ||
      element.type === "range"
    ) {
      return "number";
    }
  }

  return "text";
}

@Directive({
  selector:
    "input[sxField], textarea[sxField], select[sxField]",
  standalone: true,
  exportAs: "sxField",
})
export class StreamixFieldDirective
  implements OnChanges, OnDestroy {
  private static nextDescriptionId = 0;

  private readonly element =
    inject<ElementRef<NativeFieldElement>>(ElementRef);

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);

  private stopWatching?: () => void;
  private attachedField?: Field<unknown>;
  private kind: ElementKind = "text";
  private readonly descriptionId =
    ++StreamixFieldDirective.nextDescriptionId;
  private readonly nativeValidationSource = {};
  private readonly validationSources = new Map<
    object,
    FieldValidationSource<unknown>
  >();

  readonly hintId = `sx-field-${this.descriptionId}-hint`;
  readonly errorId = `sx-field-${this.descriptionId}-error`;

  @Input({ required: true })
  sxField!: Field<unknown>;

  @Input()
  sxHint?: (value: any) => string | null;

  @Input()
  sxPendingHint?: string;

  get error(): string | null {
    return this.sxField
      ? formatFieldError(
          this.sxField,
          undefined,
          this.sxPendingHint,
        )
      : null;
  }

  get hint(): string | null {
    if (!this.sxField) return null;

    if (
      this.sxPendingHint &&
      this.sxField.pending.value
    ) {
      return this.sxPendingHint;
    }

    return this.sxHint?.(
      this.sxField.completeValue.value,
    ) ?? null;
  }

  ngOnChanges(): void {
    this.detachField();

    this.kind = detectKind(
      this.element.nativeElement,
    );

    this.disableNativeFormValidation();
    this.updateNativeValidation();
    this.attachField();
    this.render();
  }

  ngOnDestroy(): void {
    this.detachField();
  }

  addValidation(
    initial: FieldValidationSource<unknown>,
  ): ValidationRegistration<FieldValidationSource<unknown>> {
    const source = {};
    let current = initial;
    let disposed = false;

    this.validationSources.set(source, current);
    this.applyValidationSource(source, current);

    return {
      update: validation => {
        if (disposed) return;
        current = validation;
        this.validationSources.set(source, current);
        this.applyValidationSource(source, current);
      },

      revalidate: () => {
        if (disposed) return;
        this.applyValidationSource(source, current);
      },

      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.validationSources.delete(source);

        if (
          this.attachedField &&
          !this.attachedField.state.disposed
        ) {
          this.attachedField.clearValidation(source);
        }
      },
    };
  }

  @HostListener("input")
  onInput(): void {
    if (this.usesInputEvent()) {
      this.write();
    }
  }

  @HostListener("change")
  onChange(): void {
    if (!this.usesInputEvent()) {
      this.write();
    }
  }

  @HostListener("blur")
  onBlur(): void {
    if (!this.isActiveField()) return;
    this.sxField.touch();
  }

  private attachField(): void {
    if (!this.sxField) return;

    this.attachedField = this.sxField;

    for (const [
      source,
      validation,
    ] of this.validationSources) {
      this.applyValidationSource(source, validation);
    }

    this.stopWatching = watchNode(
      this.sxField,
      () => {
        this.zone.run(() => {
          this.render();
          this.cdr.detectChanges();
        });
      },
    );
  }

  private detachField(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;

    if (
      this.attachedField &&
      !this.attachedField.state.disposed
    ) {
      for (const source of this.validationSources.keys()) {
        this.attachedField.clearValidation(source);
      }
    }

    this.attachedField = undefined;
  }

  private updateNativeValidation(): void {
    this.validationSources.set(
      this.nativeValidationSource,
      {
        checks: this.collectNativeChecks(),
      },
    );
  }

  private applyValidationSource(
    source: object,
    validation: FieldValidationSource<unknown>,
  ): void {
    if (!this.attachedField || this.attachedField.state.disposed) {
      return;
    }

    this.attachedField.useValidation(
      source,
      validation,
    );
  }

  private usesInputEvent(): boolean {
    return (
      this.kind !== "select" &&
      this.kind !== "checkbox" &&
      this.kind !== "radio"
    );
  }

  private write(): void {
    if (!this.isActiveField()) return;

    const element = this.element.nativeElement;

    if (
      this.kind === "radio" &&
      element instanceof HTMLInputElement &&
      !element.checked
    ) {
      return;
    }

    this.sxField.set(this.readValue());
  }

  private isActiveField(): boolean {
    return Boolean(
      this.sxField && !this.sxField.state.disposed,
    );
  }

  private disableNativeFormValidation(): void {
    const form = this.element.nativeElement.closest("form");

    if (form instanceof HTMLFormElement) {
      form.noValidate = true;
    }
  }

  private collectNativeChecks(): Check<unknown>[] {
    const element = this.element.nativeElement;
    const nativeChecks: Check<unknown>[] = [];

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      if (element.required) {
        nativeChecks.push(
          this.kind === "checkbox"
            ? checks.requiredTrue
            : checks.required,
        );
      }

      if (
        element.minLength >= 0 &&
        element.hasAttribute("minlength")
      ) {
        nativeChecks.push(
          checks.minLength(element.minLength),
        );
      }

      if (
        element.maxLength >= 0 &&
        element.hasAttribute("maxlength")
      ) {
        nativeChecks.push(
          checks.maxLength(element.maxLength),
        );
      }
    }

    if (element instanceof HTMLInputElement) {
      if (element.type === "email") {
        nativeChecks.push(checks.email);
      }

      if (element.pattern) {
        nativeChecks.push(
          checks.pattern(element.pattern),
        );
      }

      if (
        this.kind === "number" &&
        element.min !== ""
      ) {
        const minimum = Number(element.min);

        if (Number.isFinite(minimum)) {
          nativeChecks.push(checks.min(minimum));
        }
      }

      if (
        this.kind === "number" &&
        element.max !== ""
      ) {
        const maximum = Number(element.max);

        if (Number.isFinite(maximum)) {
          nativeChecks.push(checks.max(maximum));
        }
      }
    }

    return nativeChecks;
  }

  private readValue(): unknown {
    const element = this.element.nativeElement;

    if (element instanceof HTMLInputElement) {
      switch (this.kind) {
        case "checkbox":
          return element.checked;

        case "number":
          return element.value === ""
            ? null
            : element.valueAsNumber;

        case "radio":
          return element.value;
      }
    }

    return element.value;
  }

  private render(): void {
    if (!this.sxField) return;

    const element = this.element.nativeElement;
    const value = this.sxField.completeValue.value;

    element.disabled = this.sxField.disabled.value;

    if (element instanceof HTMLInputElement) {
      if (this.kind === "checkbox") {
        element.checked = Boolean(value);
      } else if (this.kind === "radio") {
        element.checked =
          String(value ?? "") === element.value;
      } else {
        const rendered =
          value == null ? "" : String(value);

        if (element.value !== rendered) {
          element.value = rendered;
        }
      }
    } else {
      const rendered =
        value == null ? "" : String(value);

      if (element.value !== rendered) {
        element.value = rendered;
      }
    }

    const invalid =
      this.sxField.invalid.value &&
      (this.sxField.dirty.value ||
        this.sxField.touched.value);

    element.classList.toggle(
      "is-invalid",
      invalid,
    );

    element.classList.toggle(
      "is-pending",
      this.sxField.pending.value,
    );

    element.setAttribute(
      "aria-invalid",
      String(invalid),
    );

    this.renderDescriptions(element);
  }

  private renderDescriptions(
    element: NativeFieldElement,
  ): void {
    const error = this.error;
    const hint = this.hint;
    const describedBy = [
      hint ? this.hintId : null,
      error ? this.errorId : null,
    ].filter((id): id is string => id !== null);

    if (describedBy.length > 0) {
      element.setAttribute(
        "aria-describedby",
        describedBy.join(" "),
      );
    } else {
      element.removeAttribute("aria-describedby");
    }

    if (error) {
      element.setAttribute(
        "aria-errormessage",
        this.errorId,
      );
    } else {
      element.removeAttribute(
        "aria-errormessage",
      );
    }
  }
}
