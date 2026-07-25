import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
} from "@angular/core";
import { atom, derived } from "@epikodelabs/streamix";
import {
  cloneInitialProfile,
  contactOptions,
  createProfileForm,
  createSkill,
  resetProfile,
  themeOptions,
} from "../../shared/profile-form";
import {
  calculateCompletion,
  formatProfileJson,
  type ProfileFormValue,
} from "../../shared/profile-model";
import {
  bindStreamixForm,
  fieldError,
  fieldHint,
  type StreamixFormBinding,
} from "../../shared/streamix-form-binding";

@Component({
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./streamix-form.page.html",
  styleUrl: "./streamix-form.page.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StreamixFormPageComponent
  implements AfterViewInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private binding?: StreamixFormBinding;

  @ViewChild("profileForm")
  private readonly profileFormRef?: ElementRef<HTMLFormElement>;

  readonly form = createProfileForm();
  readonly skills = this.form.fields.skills;
  readonly contactOptions = contactOptions;
  readonly themeOptions = themeOptions;
  private readonly submittedPayload = atom("");
  readonly uiState = derived($ => {
    return this.createUiState(
      $(this.form.state).completeValue,
      $(this.submittedPayload),
    );
  });
  private readonly stopUiState = this.uiState.subscribe(() =>
    this.cdr.detectChanges(),
  );

  ngAfterViewInit(): void {
    const element = this.profileFormRef?.nativeElement;
    if (!element) return;

    this.binding = bindStreamixForm(element, this.form);
  }

  submit(event: Event): void {
    event.preventDefault();
    this.form.touch();

    if (this.form.invalid.value) {
      this.cdr.detectChanges();
      return;
    }

    this.submittedPayload.set(this.uiState.value.preview);
  }

  reset(): void {
    this.submittedPayload.set("");
    resetProfile(this.form, cloneInitialProfile());
  }

  addSkill(): void {
    this.skills.push(createSkill());
  }

  removeSkill(index: number): void {
    if (this.skills.items.length > 1) {
      this.skills.removeAt(index);
    }
  }

  ngOnDestroy(): void {
    this.binding?.dispose();
    this.stopUiState();
    this.uiState.dispose();
    this.submittedPayload.dispose();
    this.form.dispose();
  }

  fieldError(path: string, pendingHint?: string): string | null {
    return fieldError(this.form, path, pendingHint);
  }

  fieldHint(path: string, pendingHint?: string): string | null {
    return fieldHint(this.form, path, pendingHint);
  }

  private createUiState(
    snapshot: ProfileFormValue,
    submittedPayload: string,
  ) {
    const security = this.form.fields.security;

    return {
      completion: calculateCompletion(snapshot),
      contactMethod: snapshot.preferences.contactMethod,
      hoursPerWeek: snapshot.availability.hoursPerWeek,
      passwordError: this.passwordError(security.touched.value),
      preview: formatProfileJson(snapshot),
      remainingBio: 240 - snapshot.profile.bio.length,
      remote: snapshot.availability.remote,
      submittedPayload,
      validationSummary: this.validationSummary(),
    };
  }

  private passwordError(touched: boolean): string | null {
    if (!touched) return null;

    const formIssues = this.form.fields.security.issues.value?.["$form"];
    return typeof formIssues === "object" &&
      formIssues !== null &&
      "passwordMismatch" in formIssues
      ? "Passwords are incomplete or mismatched."
      : null;
  }

  private validationSummary(): readonly string[] {
    const { fields } = this.form;
    const items: string[] = [];

    if (fields.profile.invalid.value) {
      items.push("Profile details need cleanup.");
    }
    if (fields.security.invalid.value) {
      items.push("Passwords are incomplete or mismatched.");
    }
    if (fields.address.invalid.value) {
      items.push("Address information is incomplete.");
    }
    if (fields.availability.invalid.value) {
      items.push("Availability is outside the allowed range.");
    }
    if (fields.skills.invalid.value) {
      items.push("At least one valid skill entry is required.");
    }

    return items;
  }

}
