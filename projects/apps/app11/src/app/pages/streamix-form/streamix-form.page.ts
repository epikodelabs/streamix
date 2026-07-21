import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, inject } from "@angular/core";
import { atom, type Subscription } from "@epikodelabs/streamix";
import {
  cloneInitialProfile,
  contactOptions,
  createProfileForm,
  createSkill,
  primarySkills,
  profilePreview,
  profileReady,
  resetProfile,
  themeOptions,
  type DraftStatus,
} from "../../shared/profile-form";
import { StreamixFieldDirective } from "../../shared/streamix-field.directive";

const SAVE_DELAY = 650;
const SAVE_DURATION = 260;
const NOT_SAVED = "Not saved yet";

type StreamixFormUiState = {
  draftStatus: DraftStatus;
  lastSavedAt: string;
  passwordError: string | null;
  primarySkills: string;
  readyToSubmit: boolean;
  preview: string;
};

@Component({
  standalone: true,
  imports: [CommonModule, StreamixFieldDirective],
  templateUrl: "./streamix-form.page.html",
  styleUrl: "./streamix-form.page.scss",
})
export class StreamixFormPageComponent implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);

  readonly form = createProfileForm();

  readonly draftStatus = atom<DraftStatus>("idle");
  readonly lastSavedAt = atom<string>(NOT_SAVED);
  readonly submittedPayload = atom<string>("");

  private saveTimer?: ReturnType<typeof setTimeout>;
  private commitTimer?: ReturnType<typeof setTimeout>;
  private previousSnapshot = profilePreview(this.form);
  private readonly subs: Subscription[] = [];

  constructor() {
    const refresh = () => this.cdr.detectChanges();

    this.subs.push(
      this.form.state.subscribe(() => {
        this.queueAutosave();
        refresh();
      }),
      this.draftStatus.subscribe(refresh),
      this.lastSavedAt.subscribe(refresh),
      this.submittedPayload.subscribe(refresh),
    );
  }

  // Expose field groups directly to template
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

  get uiState(): StreamixFormUiState {
    return {
      draftStatus: this.draftStatus.value,
      lastSavedAt: this.lastSavedAt.value,
      passwordError: this.passwordError,
      primarySkills: primarySkills(this.form),
      readyToSubmit: profileReady(this.form),
      preview: profilePreview(this.form),
    };
  }

  readonly contactOptions = contactOptions;
  readonly themeOptions = themeOptions;

  readonly hoursHint = (value: unknown) => `${value} hrs/week`;

  get passwordError(): string | null {
    const security = this.form.fields.security;

    if (
      !security.fields.password.touched.value &&
      !security.fields.confirmPassword.touched.value
    ) {
      return null;
    }

    const formIssues = security.issues.value?.["$form"];

    return (
      typeof formIssues === "object" &&
      formIssues !== null &&
      "passwordMismatch" in formIssues
    )
      ? "Passwords must match."
      : null;
  }

  submit(event: Event): void {
    event.preventDefault();
    this.form.touch();
    if (!profileReady(this.form)) {
      this.cdr.detectChanges();
      return;
    }

    this.submittedPayload.set(profilePreview(this.form));
    this.draftStatus.set("saved");
  }

  reset(): void {
    resetProfile(this.form, cloneInitialProfile());
    this.previousSnapshot = profilePreview(this.form);
    this.cancelAutosave();
    this.draftStatus.set("idle");
    this.lastSavedAt.set(NOT_SAVED);
    this.submittedPayload.set("");
  }

  addSkill(): void {
    this.form.fields.skills.push(createSkill());
  }

  removeSkill(index: number): void {
    if (this.form.fields.skills.items.length > 1) {
      this.form.fields.skills.removeAt(index);
    }
  }

  ngOnDestroy(): void {
    this.cancelAutosave();
    this.subs.forEach(unsub => unsub());
    this.form.dispose();
    this.draftStatus.dispose();
    this.lastSavedAt.dispose();
    this.submittedPayload.dispose();
  }

  private queueAutosave(): void {
    const snapshot = profilePreview(this.form);
    if (snapshot === this.previousSnapshot) return;
    this.previousSnapshot = snapshot;

    clearTimeout(this.saveTimer);
    clearTimeout(this.commitTimer);
    this.draftStatus.set("editing");

    this.saveTimer = setTimeout(() => {
      this.draftStatus.set("saving");
      this.commitTimer = setTimeout(() => {
        this.lastSavedAt.set(
          new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        );
        this.draftStatus.set("saved");
      }, SAVE_DURATION);
    }, SAVE_DELAY);
  }

  private cancelAutosave(): void {
    clearTimeout(this.saveTimer);
    clearTimeout(this.commitTimer);
    this.saveTimer = undefined;
    this.commitTimer = undefined;
  }
}
