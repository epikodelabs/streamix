import {
  ChangeDetectorRef,
  Directive,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  NgZone,
  OnDestroy,
  inject,
} from "@angular/core";
import {
  formatFieldError,
  type Field,
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
  private kind: ElementKind = "text";
  private readonly descriptionId = ++StreamixFieldDirective.nextDescriptionId;

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
    this.stopWatching?.();

    this.kind = detectKind(
      this.element.nativeElement,
    );

    this.stopWatching = this.sxField
      ? watchNode(
          this.sxField,
          () => {
            this.zone.run(() => {
              this.render();
              this.cdr.detectChanges();
            });
          },
        )
      : undefined;

    this.render();
  }

  ngOnDestroy(): void {
    this.stopWatching?.();
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
    return Boolean(this.sxField && !this.sxField.state.disposed);
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
      (this.sxField.dirty.value || this.sxField.touched.value);

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

  private renderDescriptions(element: NativeFieldElement): void {
    const error = this.error;
    const hint = this.hint;
    const describedBy = [
      hint ? this.hintId : null,
      error ? this.errorId : null,
    ].filter((id): id is string => id !== null);

    if (describedBy.length > 0) {
      element.setAttribute("aria-describedby", describedBy.join(" "));
    } else {
      element.removeAttribute("aria-describedby");
    }

    if (error) {
      element.setAttribute("aria-errormessage", this.errorId);
    } else {
      element.removeAttribute("aria-errormessage");
    }
  }
}
