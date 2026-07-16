import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { debounce, filter, pipe, scope, tap } from '@epikodelabs/streamix';

import {
  formatProfileJson,
  type ProfileFormValue,
  type SkillValue,
} from '../../shared/profile-model';
import {
  addressFields,
  applyStreamixUpdate,
  availabilityFields,
  cloneInitialProfileValue,
  contactOptions,
  createEmptySkill,
  createStreamixUiState,
  getFieldError,
  getFieldHint,
  getPasswordError,
  isReservedUsername,
  isUsernamePath,
  parseEventValue,
  profileFields,
  readPath,
  removeSkill,
  securityFields,
  skillFields,
  skillPath,
  themeOptions,
  type PrimitiveValue,
  type StreamixUiShape,
  type TouchedPath,
  type ValueKind,
  validateUsernameSync,
} from '../../shared/streamix-form.helpers';

@Component({
  standalone: true,
  templateUrl: './streamix-form.page.html',
  styleUrl: './streamix-form.page.scss',
})
export class StreamixFormPageComponent implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private usernameValidationTimer: ReturnType<typeof setTimeout> | null = null;
  private usernameValidationToken = 0;
  private readonly formState = scope<ProfileFormValue>(cloneInitialProfileValue());
  private readonly uiStateScope = scope(() => createStreamixUiState(this.formState));

  submittedPayload = '';

  readonly profileFields = profileFields;
  readonly securityFields = securityFields;
  readonly addressFields = addressFields;
  readonly availabilityFields = availabilityFields;
  readonly skillFields = skillFields;
  readonly contactOptions = contactOptions;
  readonly themeOptions = themeOptions;
  readonly uiState = this.uiStateScope as unknown as StreamixUiShape;

  constructor() {
    this.startAutosave();
  }

  get skills(): SkillValue[] {
    return this.formState.skills;
  }

  ngOnDestroy(): void {
    this.clearUsernameValidationTimer();
    this.uiStateScope.dispose();
    this.formState.dispose();
  }

  touchField(path: TouchedPath): void {
    this.uiState.touchField(path);

    if (isUsernamePath(path)) {
      this.runUsernameValidation();
    }

    this.syncView();
  }

  addSkill(): void {
    this.formState.skills = [...this.formState.skills, createEmptySkill()];
    this.uiState.queueChange();
    this.syncView();
  }

  removeSkill(index: number): void {
    const nextTouchedFields = removeSkill(
      this.formState,
      this.uiState.touchedFields,
      index,
    );

    if (nextTouchedFields === this.uiState.touchedFields) {
      return;
    }

    this.uiState.touchedFields = nextTouchedFields;
    this.uiState.queueChange();
    this.syncView();
  }

  submit(event: Event): void {
    event.preventDefault();
    this.uiState.setAttemptedSubmit(true);

    if (!this.uiState.valid) {
      this.syncView();
      return;
    }

    this.submittedPayload = formatProfileJson(this.formState.snapshot());
    this.uiState.draftStatus = 'saved';
    this.syncView();
  }

  resetForm(): void {
    this.uiState.resetAll();
    this.submittedPayload = '';
    this.clearUsernameValidationTimer();
    this.syncView();
  }

  fieldError(path: TouchedPath): string | null {
    return getFieldError(
      this.uiState.errors,
      path,
      this.uiState.attemptedSubmit,
      this.uiState.touchedFields,
      this.uiState.usernamePending,
    );
  }

  read(path: TouchedPath): PrimitiveValue {
    return readPath(this.formState, path);
  }

  update(path: TouchedPath, value: PrimitiveValue): void {
    applyStreamixUpdate(this.formState, this.uiState, path, value);
    this.syncView();
  }

  updateFromEvent(
    path: TouchedPath,
    event: Event,
    kind: ValueKind = 'text',
  ): void {
    this.update(path, parseEventValue(event, kind));
  }

  skillPath(index: number, key: keyof SkillValue): TouchedPath {
    return skillPath(index, key);
  }

  fieldHint(path: TouchedPath): string | null {
    return getFieldHint(path, this.uiState.usernamePending, this.read(path));
  }

  passwordError(): string | null {
    return getPasswordError(this.uiState);
  }

  private runUsernameValidation(): void {
    this.clearUsernameValidationTimer();

    const username = String(this.read('profile.username')).trim().toLowerCase();
    const syncError = validateUsernameSync(username);

    this.uiState.usernameTaken = false;
    this.uiState.usernamePending = false;

    if (syncError !== null || username.length === 0) {
      this.syncView();
      return;
    }

    const token = ++this.usernameValidationToken;
    this.uiState.usernamePending = true;
    this.syncView();

    this.usernameValidationTimer = setTimeout(() => {
      if (token !== this.usernameValidationToken) {
        return;
      }

      this.uiState.usernamePending = false;
      this.uiState.usernameTaken = isReservedUsername(username);
      this.syncView();
    }, 300);
  }

  private startAutosave(): void {
    const autosave = pipe(
      this.uiStateScope.at('saveRequest'),
      filter((snapshot) => snapshot !== null),
      debounce(650),
      tap(async (snapshot: ProfileFormValue | null) => {
        if (!snapshot) {
          return;
        }

        this.uiState.markSaving();
        this.syncView();

        await new Promise<void>((resolve) => {
          setTimeout(resolve, 260);
        });

        this.uiState.markSaved(
          new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
        );
        this.syncView();
      }),
    ).subscribe(() => {});

    this.uiStateScope.cleanups.add(() => autosave());
  }

  private clearUsernameValidationTimer(): void {
    if (!this.usernameValidationTimer) {
      return;
    }

    clearTimeout(this.usernameValidationTimer);
    this.usernameValidationTimer = null;
  }

  private syncView(): void {
    this.cdr.detectChanges();
  }
}
