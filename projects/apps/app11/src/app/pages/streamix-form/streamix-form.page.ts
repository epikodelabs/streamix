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
  submittedPayload: string;
  passwordLengthError: string | null;
  confirmPasswordLengthError: string | null;
  passwordError: string | null;
  primarySkills: string;
  readyToSubmit: boolean;
  preview: string;
};

type FormUiProjection = Pick<
  StreamixFormUiState,
  | "passwordLengthError"
  | "confirmPasswordLengthError"
  | "passwordError"
  | "primarySkills"
  | "readyToSubmit"
  | "preview"
>;

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

  readonly draftStatus = atom<DraftStatus>("idle");
  readonly lastSavedAt = atom<string>(NOT_SAVED);

  private saveTimer?: ReturnType<typeof setTimeout>;
  private commitTimer?: ReturnType<typeof setTimeout>;
  private submittedPayload = "";
  private synchronizingForm = false;
  readonly uiState = atom<StreamixFormUiState>(this.createUiState());
  private previousSnapshot = this.uiState.value.preview;
  private readonly subs: Subscription[] = [];

  constructor() {
    const refresh = () => this.cdr.detectChanges();

    this.subs.push(
      this.form.state.subscribe(() => {
        this.refreshFromForm();
      }),
      this.draftStatus.subscribe(() => {
        if (!this.synchronizingForm) this.refreshUiState();
      }),
      this.lastSavedAt.subscribe(() => this.refreshUiState()),
      this.uiState.subscribe(refresh),
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

  readonly contactOptions = contactOptions;
  readonly themeOptions = themeOptions;

  readonly hoursHint = (value: unknown) => `${value} hrs/week`;

  private passwordLengthError(): string | null {
    const value = this.security.password.value.value ?? "";

    return value.length > 0 && value.length < 8
      ? "Minimum length is 8."
      : null;
  }

  private confirmPasswordLengthError(): string | null {
    const value = this.security.confirmPassword.value.value ?? "";

    return value.length > 0 && value.length < 8
      ? "Minimum length is 8."
      : null;
  }

  private passwordError(): string | null {
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

    this.submittedPayload = profilePreview(this.form);
    this.draftStatus.set("saved");
    this.refreshUiState();
  }

  reset(): void {
    this.submittedPayload = "";
    resetProfile(this.form, cloneInitialProfile());
    this.previousSnapshot = profilePreview(this.form);
    this.cancelAutosave();
    this.draftStatus.set("idle");
    this.lastSavedAt.set(NOT_SAVED);
    this.refreshUiState();
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
  }

  private refreshFromForm(): void {
    const projection = this.createFormProjection();

    this.synchronizingForm = true;
    try {
      this.queueAutosave(projection.preview);
      this.refreshUiState(projection);
    } finally {
      this.synchronizingForm = false;
    }
  }

  private queueAutosave(snapshot: string): void {
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

  private createUiState(): StreamixFormUiState {
    return {
      draftStatus: this.draftStatus.value,
      lastSavedAt: this.lastSavedAt.value,
      submittedPayload: this.submittedPayload,
      ...this.createFormProjection(),
    };
  }

  private createFormProjection(): FormUiProjection {
    return {
      passwordLengthError: this.passwordLengthError(),
      confirmPasswordLengthError: this.confirmPasswordLengthError(),
      passwordError: this.passwordError(),
      primarySkills: primarySkills(this.form),
      readyToSubmit: profileReady(this.form),
      preview: profilePreview(this.form),
    };
  }

  private refreshUiState(projection?: FormUiProjection): void {
    const current = this.uiState.value;
    const next: StreamixFormUiState = {
      draftStatus: this.draftStatus.value,
      lastSavedAt: this.lastSavedAt.value,
      submittedPayload: this.submittedPayload,
      ...(projection ?? {
        passwordLengthError: current.passwordLengthError,
        confirmPasswordLengthError: current.confirmPasswordLengthError,
        passwordError: current.passwordError,
        primarySkills: current.primarySkills,
        readyToSubmit: current.readyToSubmit,
        preview: current.preview,
      }),
    };

    if (
      next.draftStatus === current.draftStatus &&
      next.lastSavedAt === current.lastSavedAt &&
      next.submittedPayload === current.submittedPayload &&
      next.passwordLengthError === current.passwordLengthError &&
      next.confirmPasswordLengthError === current.confirmPasswordLengthError &&
      next.passwordError === current.passwordError &&
      next.primarySkills === current.primarySkills &&
      next.readyToSubmit === current.readyToSubmit &&
      next.preview === current.preview
    ) {
      return;
    }

    this.uiState.set(next);
  }
}
