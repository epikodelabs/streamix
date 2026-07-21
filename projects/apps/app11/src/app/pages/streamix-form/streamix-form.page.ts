import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  inject,
} from "@angular/core";
import { atom, type Subscription } from "@epikodelabs/streamix";
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

type StreamixFormUiState = {
  completion: number;
  contactMethod: string;
  passwordError: string | null;
  preview: string;
  remainingBio: number;
  remote: boolean;
  submittedPayload: string;
  validationSummary: readonly string[];
};

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
  readonly contactOptions = contactOptions;
  readonly themeOptions = themeOptions;
  readonly uiState = atom<StreamixFormUiState>(this.createUiState());

  private submittedPayload = "";
  private readonly subs: Subscription[] = [];

  constructor() {
    this.subs.push(
      this.form.state.subscribe(() => this.refreshUiState()),
      this.uiState.subscribe(() => this.cdr.detectChanges()),
    );
  }

  get profile() {
    return this.form.fields.profile.fields;
  }

  get security() {
    return this.form.fields.security.fields;
  }

  get address() {
    return this.form.fields.address.fields;
  }

  get preferences() {
    return this.form.fields.preferences.fields;
  }

  get availability() {
    return this.form.fields.availability.fields;
  }

  get skills() {
    return this.form.fields.skills;
  }

  submit(event: Event): void {
    event.preventDefault();
    this.form.touch();

    if (this.form.invalid.value) {
      this.cdr.detectChanges();
      return;
    }

    this.submittedPayload = profilePreview(this.form);
    this.refreshUiState();
  }

  reset(): void {
    this.submittedPayload = "";
    resetProfile(this.form, cloneInitialProfile());
    this.refreshUiState();
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
    this.subs.forEach(unsubscribe => unsubscribe());
    this.uiState.dispose();
    this.form.dispose();
  }

  private createUiState(): StreamixFormUiState {
    const snapshot = this.form.completeValue.value;
    const security = this.form.fields.security;

    return {
      completion: completion(this.form),
      contactMethod: snapshot.preferences.contactMethod,
      passwordError: this.passwordError(security.touched.value),
      preview: profilePreview(this.form),
      remainingBio: 240 - snapshot.profile.bio.length,
      remote: snapshot.availability.remote,
      submittedPayload: this.submittedPayload,
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

  private refreshUiState(): void {
    const current = this.uiState.value;
    const next = this.createUiState();

    if (
      next.completion === current.completion &&
      next.contactMethod === current.contactMethod &&
      next.passwordError === current.passwordError &&
      next.preview === current.preview &&
      next.remainingBio === current.remainingBio &&
      next.remote === current.remote &&
      next.submittedPayload === current.submittedPayload &&
      next.validationSummary.length === current.validationSummary.length &&
      next.validationSummary.every(
        (item, index) => item === current.validationSummary[index],
      )
    ) {
      return;
    }

    this.uiState.set(next);
  }
}
