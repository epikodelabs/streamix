import { AbstractControl } from '@angular/forms';
import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { debounce, filter, method, pipe, scope, tap } from '@epikodelabs/streamix';

import {
  calculateCompletion,
  createProfileForm,
  createSkillGroup,
  formatProfileJson,
  getInitialProfileValue,
  type ProfileFormValue,
} from './form-model';

type DraftStatus = 'idle' | 'editing' | 'saving' | 'saved';

interface StreamixScopeShape {
  draftStatus: DraftStatus;
  lastSavedAt: string;
  changeCount: number;
  valid: boolean;
  saveRequest: ProfileFormValue | null;
  formSnapshot: ProfileFormValue;
  activityLog: string[];
  completion: number;
  primarySkills: string;
  readyToSubmit: boolean;
  appendLog: (message: string) => void;
  queueSnapshot: (snapshot: ProfileFormValue, valid: boolean) => void;
  markSaving: () => void;
  markSaved: (timestamp: string) => void;
  resetState: (snapshot: ProfileFormValue, valid: boolean) => void;
}

@Component({
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './streamix-form.page.html',
  styleUrl: './streamix-form.page.scss',
})
export class StreamixFormPageComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly form = createProfileForm(this.fb);
  readonly profile = this.form.controls.profile.controls;
  readonly security = this.form.controls.security.controls;
  readonly address = this.form.controls.address.controls;
  readonly preferences = this.form.controls.preferences.controls;
  readonly availability = this.form.controls.availability.controls;

  attemptedSubmit = false;
  submittedPayload = '';
  preview = '';

  private readonly streamixState = scope<StreamixScopeShape>(() => ({
    draftStatus: 'idle',
    lastSavedAt: 'Not saved yet',
    changeCount: 0,
    valid: this.form.valid,
    saveRequest: null,
    formSnapshot: structuredClone(this.form.getRawValue()),
    activityLog: ['Streamix scope connected.'],
    completion: (self: any) => calculateCompletion(self.formSnapshot as ProfileFormValue),
    primarySkills: (self: any) =>
      ((self.formSnapshot as ProfileFormValue).skills
        .filter((skill) => skill.primary)
        .map((skill) => skill.name.trim())
        .filter(Boolean)
        .join(', ') || 'No primary skill selected'),
    readyToSubmit: (self: any) => {
      const snapshot = self.formSnapshot as ProfileFormValue;

      return (
        self.valid &&
        self.completion >= 85 &&
        snapshot.skills.length > 0 &&
        snapshot.security.password === snapshot.security.confirmPassword
      );
    },
    appendLog: method((self: any, message: string) => {
      const time = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      self.activityLog = [`${time} ${message}`, ...self.activityLog].slice(0, 8);
    }),
    queueSnapshot: method((self: any, snapshot: ProfileFormValue, valid: boolean) => {
      self.formSnapshot = structuredClone(snapshot);
      self.valid = valid;
      self.draftStatus = 'editing';
      self.changeCount = self.changeCount + 1;
      self.appendLog(`Queued change ${self.changeCount} for autosave.`);
      self.saveRequest = structuredClone(snapshot);
    }),
    markSaving: method((self: any) => {
      self.draftStatus = 'saving';
      self.appendLog('Debounced autosave started.');
    }),
    markSaved: method((self: any, timestamp: string) => {
      self.lastSavedAt = timestamp;
      self.draftStatus = 'saved';
      self.appendLog('Draft persisted through streamix.');
    }),
    resetState: method((self: any, snapshot: ProfileFormValue, valid: boolean) => {
      self.formSnapshot = structuredClone(snapshot);
      self.valid = valid;
      self.saveRequest = null;
      self.draftStatus = 'idle';
      self.lastSavedAt = 'Not saved yet';
      self.changeCount = 0;
      self.activityLog = [];
      self.appendLog('Reset form and streamix scope.');
    }),
  }));

  constructor() {
    this.preview = formatProfileJson(this.streamixState.formSnapshot);
    this.watchState();
    this.startAutosave();
    this.watchForm();

    this.destroyRef.onDestroy(() => {
      this.streamixState.dispose();
    });
  }

  get skills() {
    return this.form.controls.skills.controls;
  }

  get draftStatus(): DraftStatus {
    return this.streamixState.draftStatus;
  }

  get lastSavedAt(): string {
    return this.streamixState.lastSavedAt;
  }

  get changeCount(): number {
    return this.streamixState.changeCount;
  }

  get completion(): number {
    return this.streamixState.completion;
  }

  get primarySkills(): string {
    return this.streamixState.primarySkills;
  }

  get readyToSubmit(): boolean {
    return this.streamixState.readyToSubmit;
  }

  get activityLog(): string[] {
    return this.streamixState.activityLog;
  }

  addSkill(): void {
    this.form.controls.skills.push(createSkillGroup(this.fb));
    this.streamixState.appendLog('Added a skill row.');
    this.cdr.detectChanges();
  }

  removeSkill(index: number): void {
    if (this.form.controls.skills.length === 1) {
      return;
    }

    this.form.controls.skills.removeAt(index);
    this.streamixState.appendLog(`Removed skill row ${index + 1}.`);
    this.cdr.detectChanges();
  }

  submit(): void {
    this.attemptedSubmit = true;
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      this.streamixState.appendLog('Submit blocked because the form is invalid.');
      this.cdr.detectChanges();
      return;
    }

    this.submittedPayload = formatProfileJson(this.form.getRawValue());
    this.streamixState.draftStatus = 'saved';
    this.streamixState.appendLog('Submitted a valid payload.');
    this.cdr.detectChanges();
  }

  resetForm(): void {
    const initial = getInitialProfileValue();

    this.form.controls.skills.clear();
    for (const skill of initial.skills) {
      this.form.controls.skills.push(createSkillGroup(this.fb, skill));
    }

    this.form.reset(initial);
    this.form.markAsPristine();
    this.form.markAsUntouched();

    this.streamixState.resetState(initial, this.form.valid);
    this.preview = formatProfileJson(initial);
    this.submittedPayload = '';
    this.attemptedSubmit = false;
    this.cdr.detectChanges();
  }

  shouldShowError(control: AbstractControl | null): boolean {
    if (!control) {
      return false;
    }

    return control.invalid && (control.touched || control.dirty || this.attemptedSubmit);
  }

  fieldError(control: AbstractControl | null): string | null {
    if (!control || !this.shouldShowError(control) || !control.errors) {
      return null;
    }

    if (control.errors['required']) {
      return 'This field is required.';
    }
    if (control.errors['email']) {
      return 'Use a valid email address.';
    }
    if (control.errors['minlength']) {
      return `Minimum length is ${control.errors['minlength'].requiredLength}.`;
    }
    if (control.errors['maxlength']) {
      return `Maximum length is ${control.errors['maxlength'].requiredLength}.`;
    }
    if (control.errors['pattern']) {
      return 'Format is invalid.';
    }
    if (control.errors['min']) {
      return `Minimum value is ${control.errors['min'].min}.`;
    }
    if (control.errors['max']) {
      return `Maximum value is ${control.errors['max'].max}.`;
    }
    if (control.errors['usernameTaken']) {
      return 'That username is reserved for demos.';
    }

    return 'Please review this field.';
  }

  passwordError(): string | null {
    const group = this.form.controls.security;

    if (!group.errors?.['passwordMismatch']) {
      return null;
    }

    if (!group.touched && !this.attemptedSubmit) {
      return null;
    }

    return 'Passwords must match.';
  }

  private watchState(): void {
    const keys: Array<
      | 'draftStatus'
      | 'lastSavedAt'
      | 'changeCount'
      | 'completion'
      | 'primarySkills'
      | 'readyToSubmit'
      | 'activityLog'
    > = [
      'draftStatus',
      'lastSavedAt',
      'changeCount',
      'completion',
      'primarySkills',
      'readyToSubmit',
      'activityLog',
    ];

    for (const key of keys) {
      const subscription = this.streamixState.at(key).subscribe(() => {
        this.cdr.detectChanges();
      });
      this.streamixState.cleanups.add(() => subscription());
    }
  }

  private startAutosave(): void {
    const autosave = pipe(
      this.streamixState.at('saveRequest'),
      filter((snapshot) => snapshot !== null),
      debounce(650),
      tap(async (snapshot: ProfileFormValue | null) => {
        if (!snapshot) {
          return;
        }

        this.streamixState.markSaving();

        await new Promise<void>((resolve) => {
          setTimeout(resolve, 260);
        });

        this.streamixState.markSaved(
          new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
        );
      }),
    ).subscribe(() => {});

    this.streamixState.cleanups.add(() => autosave());
  }

  private watchForm(): void {
    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.streamixState.valid = this.form.valid;
        this.cdr.detectChanges();
      });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const snapshot = structuredClone(this.form.getRawValue());

        this.streamixState.queueSnapshot(snapshot, this.form.valid);
        this.preview = formatProfileJson(snapshot);
        this.cdr.detectChanges();
      });
  }
}
