import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  inject,
} from "@angular/core";
import { atom, derived } from "@epikodelabs/streamix";
import {
  cloneInitialProfile,
  completion,
  contactOptions,
  createProfileForm,
  createSkill,
  profilePreview,
  resetProfile,
  themeOptions,
} from "../../shared/profile-form";
import { StreamixFieldDirective } from "../../shared/streamix-field.directive";

@Component({
  standalone: true,
  imports: [CommonModule, StreamixFieldDirective],
  templateUrl: "./streamix-form.page.html",
  styleUrl: "./streamix-form.page.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StreamixFormPageComponent implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);

  readonly form = createProfileForm();
  readonly profile = this.form.fields.profile.fields;
  readonly security = this.form.fields.security.fields;
  readonly address = this.form.fields.address.fields;
  readonly preferences = this.form.fields.preferences.fields;
  readonly availability = this.form.fields.availability.fields;
  readonly skills = this.form.fields.skills;
  readonly contactOptions = contactOptions;
  readonly themeOptions = themeOptions;
  private readonly submittedPayload = atom("");
  readonly uiState = derived($ => {
    $(this.form.state);
    return this.createUiState($(this.submittedPayload));
  });
  private readonly stopUiState = this.uiState.subscribe(() =>
    this.cdr.detectChanges(),
  );

  submit(event: Event): void {
    event.preventDefault();
    this.form.touch();

    if (this.form.invalid.value) {
      this.cdr.detectChanges();
      return;
    }

    this.submittedPayload.set(profilePreview(this.form));
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
    this.stopUiState();
    this.uiState.dispose();
    this.submittedPayload.dispose();
    this.form.dispose();
  }

  private createUiState(submittedPayload: string) {
    const snapshot = this.form.completeValue.value;
    const security = this.form.fields.security;

    return {
      completion: completion(this.form),
      contactMethod: snapshot.preferences.contactMethod,
      confirmPasswordLengthError: this.minimumLengthError(
        security.fields.confirmPassword.value.value,
      ),
      passwordError: this.passwordError(security.touched.value),
      passwordLengthError: this.minimumLengthError(
        security.fields.password.value.value,
      ),
      preview: profilePreview(this.form),
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

  private minimumLengthError(value: string): string | null {
    return value.length > 0 && value.length < 8
      ? "Minimum length is 8."
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
