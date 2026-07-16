import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { debounce, filter, method, pipe, scope, tap } from '@epikodelabs/streamix';

import {
  calculateCompletion,
  formatProfileJson,
  type ContactMethod,
  getInitialProfileValue,
  type ProfileFormValue,
  type SkillValue,
  type ThemePreference,
} from './profile-model';

type DraftStatus = 'idle' | 'editing' | 'saving' | 'saved';
type TouchedPath = string;

interface StreamixErrors {
  profile: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    username: string | null;
    bio: string | null;
  };
  security: {
    password: string | null;
    confirmPassword: string | null;
    group: string | null;
  };
  address: {
    country: string | null;
    city: string | null;
    postalCode: string | null;
  };
  availability: {
    startDate: string | null;
    hoursPerWeek: string | null;
  };
  skills: Array<{
    name: string | null;
    years: string | null;
  }>;
  summary: string[];
}

type ProfileSection = ProfileFormValue['profile'];
type SecuritySection = ProfileFormValue['security'];
type AddressSection = ProfileFormValue['address'];
type PreferencesSection = {
  contactMethod: ContactMethod;
  theme: ThemePreference;
  newsletter: boolean;
};
type AvailabilitySection = ProfileFormValue['availability'];

interface StreamixUiShape {
  touchedFields: TouchedPath[];
  usernamePending: boolean;
  usernameTaken: boolean;
  attemptedSubmit: boolean;
  draftStatus: DraftStatus;
  lastSavedAt: string;
  changeCount: number;
  saveRequest: ProfileFormValue | null;
  activityLog: string[];
  errors: StreamixErrors;
  valid: boolean;
  completion: number;
  primarySkills: string;
  readyToSubmit: boolean;
  preview: string;
  appendLog: (message: string) => void;
  touchField: (path: TouchedPath) => void;
  queueChange: () => void;
  markSaving: () => void;
  markSaved: (timestamp: string) => void;
  setAttemptedSubmit: (value: boolean) => void;
  resetAll: () => void;
}

const RESERVED_USERNAMES = new Set(['admin', 'angular', 'root', 'streamix']);
const POSTAL_CODE_PATTERN = /^[A-Z0-9 -]{4,10}$/i;

@Component({
  standalone: true,
  templateUrl: './streamix-form.page.html',
  styleUrl: './streamix-form.page.scss',
})
export class StreamixFormPageComponent implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private usernameValidationTimer: ReturnType<typeof setTimeout> | null = null;
  private usernameValidationToken = 0;

  submittedPayload = '';

  private readonly formState = scope<ProfileFormValue>(structuredClone(getInitialProfileValue()));

  private readonly uiState = scope<StreamixUiShape>(() => ({
    touchedFields: [] as TouchedPath[],
    usernamePending: false,
    usernameTaken: false,
    attemptedSubmit: false,
    draftStatus: 'idle',
    lastSavedAt: 'Not saved yet',
    changeCount: 0,
    saveRequest: null,
    activityLog: ['Streamix scope connected.'],
    errors: (self: any): StreamixErrors =>
      validateSnapshot(this.formState.snapshot(), self.usernameTaken),
    valid: (self: any) =>
      (self.errors as StreamixErrors).summary.length === 0 && !self.usernamePending,
    completion: () => calculateCompletion(this.formState.snapshot()),
    primarySkills: () =>
      (this.formState.snapshot().skills
        .filter((skill) => skill.primary)
        .map((skill) => skill.name.trim())
        .filter(Boolean)
        .join(', ') || 'No primary skill selected'),
    readyToSubmit: (self: any) =>
      self.valid &&
      self.completion >= 85 &&
      this.formState.snapshot().skills.length > 0,
    preview: () => formatProfileJson(this.formState.snapshot()),
    appendLog: method((self: any, message: string) => {
      const time = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      self.activityLog = [`${time} ${message}`, ...self.activityLog].slice(0, 8);
    }),
    touchField: method((self: any, path: TouchedPath) => {
      if (self.touchedFields.includes(path)) {
        return;
      }

      self.touchedFields = [...self.touchedFields, path];
    }),
    queueChange: method((self: any) => {
      self.draftStatus = 'editing';
      self.changeCount = self.changeCount + 1;
      self.appendLog(`Queued change ${self.changeCount} for autosave.`);
      self.saveRequest = structuredClone(this.formState.snapshot());
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
    setAttemptedSubmit: method((self: any, value: boolean) => {
      self.attemptedSubmit = value;
    }),
    resetAll: method((self: any) => {
      const reset = getInitialProfileValue();

      this.formState.profile.firstName = reset.profile.firstName;
      this.formState.profile.lastName = reset.profile.lastName;
      this.formState.profile.email = reset.profile.email;
      this.formState.profile.username = reset.profile.username;
      this.formState.profile.bio = reset.profile.bio;

      this.formState.security.password = reset.security.password;
      this.formState.security.confirmPassword = reset.security.confirmPassword;

      this.formState.address.country = reset.address.country;
      this.formState.address.city = reset.address.city;
      this.formState.address.postalCode = reset.address.postalCode;

      this.formState.preferences.contactMethod = reset.preferences.contactMethod;
      this.formState.preferences.theme = reset.preferences.theme;
      this.formState.preferences.newsletter = reset.preferences.newsletter;

      this.formState.availability.startDate = reset.availability.startDate;
      this.formState.availability.hoursPerWeek = reset.availability.hoursPerWeek;
      this.formState.availability.remote = reset.availability.remote;

      this.formState.skills = structuredClone(reset.skills);

      self.touchedFields = [];
      self.usernamePending = false;
      self.usernameTaken = false;
      self.attemptedSubmit = false;
      self.draftStatus = 'idle';
      self.lastSavedAt = 'Not saved yet';
      self.changeCount = 0;
      self.saveRequest = null;
      self.activityLog = [];
      self.appendLog('Reset form and streamix scope.');
    }),
  }));

  constructor() {
    this.startAutosave();
  }

  get profile(): ProfileSection {
    return this.formState.profile as ProfileSection;
  }

  get security(): SecuritySection {
    return this.formState.security as SecuritySection;
  }

  get address(): AddressSection {
    return this.formState.address as AddressSection;
  }

  get preferences(): PreferencesSection {
    return this.formState.preferences as PreferencesSection;
  }

  get availability(): AvailabilitySection {
    return this.formState.availability as AvailabilitySection;
  }

  get skills(): SkillValue[] {
    return this.formState.skills;
  }

  get draftStatus(): DraftStatus {
    return this.uiState.draftStatus;
  }

  get lastSavedAt(): string {
    return this.uiState.lastSavedAt;
  }

  get changeCount(): number {
    return this.uiState.changeCount;
  }

  get completion(): number {
    return this.uiState.completion;
  }

  get primarySkills(): string {
    return this.uiState.primarySkills;
  }

  get readyToSubmit(): boolean {
    return this.uiState.readyToSubmit;
  }

  get activityLog(): string[] {
    return this.uiState.activityLog;
  }

  get usernamePending(): boolean {
    return this.uiState.usernamePending;
  }

  get preview(): string {
    return this.uiState.preview;
  }

  get validationSummary(): string[] {
    return this.uiState.errors.summary;
  }

  ngOnDestroy(): void {
    if (this.usernameValidationTimer) {
      clearTimeout(this.usernameValidationTimer);
      this.usernameValidationTimer = null;
    }
    this.uiState.dispose();
    this.formState.dispose();
  }

  updateProfileField(
    key: keyof ProfileFormValue['profile'],
    value: string,
  ): void {
    (this.formState.profile as any)[key] = value;

    if (key === 'username') {
      this.uiState.usernameTaken = false;
      this.uiState.usernamePending = false;
    }

    this.uiState.queueChange();
    this.cdr.detectChanges();
  }

  updateSecurityField(
    key: keyof ProfileFormValue['security'],
    value: string,
  ): void {
    (this.formState.security as any)[key] = value;
    this.uiState.queueChange();
    this.cdr.detectChanges();
  }

  updateAddressField(
    key: keyof ProfileFormValue['address'],
    value: string,
  ): void {
    (this.formState.address as any)[key] = value;
    this.uiState.queueChange();
    this.cdr.detectChanges();
  }

  updatePreferenceField(
    key: keyof ProfileFormValue['preferences'],
    value: string | boolean,
  ): void {
    (this.formState.preferences as any)[key] = value;
    this.uiState.queueChange();
    this.cdr.detectChanges();
  }

  updateAvailabilityField(
    key: keyof ProfileFormValue['availability'],
    value: string | number | boolean,
  ): void {
    (this.formState.availability as any)[key] = value;
    this.uiState.queueChange();
    this.cdr.detectChanges();
  }

  updateSkillField(
    index: number,
    key: keyof SkillValue,
    value: string | number | boolean,
  ): void {
    const nextSkills = structuredClone(this.formState.skills);
    (nextSkills[index] as any)[key] = value;
    this.formState.skills = nextSkills;
    this.uiState.queueChange();
    this.cdr.detectChanges();
  }

  touchField(path: TouchedPath): void {
    this.uiState.touchField(path);

    if (path === 'profile.username') {
      this.runUsernameValidation();
    }

    this.cdr.detectChanges();
  }

  addSkill(): void {
    this.formState.skills = [
      ...this.formState.skills,
      { name: '', years: 1, primary: false },
    ];
    this.uiState.appendLog('Added a skill row.');
    this.uiState.queueChange();
    this.cdr.detectChanges();
  }

  removeSkill(index: number): void {
    if (this.formState.skills.length === 1) {
      return;
    }

    this.formState.skills = this.formState.skills.filter(
      (_skill, skillIndex) => skillIndex !== index,
    );
    this.uiState.touchedFields = remapTouchedFieldsAfterSkillRemoval(
      this.uiState.touchedFields,
      index,
    );
    this.uiState.appendLog(`Removed skill row ${index + 1}.`);
    this.uiState.queueChange();
    this.cdr.detectChanges();
  }

  submit(event: Event): void {
    event.preventDefault();
    this.uiState.setAttemptedSubmit(true);

    if (!this.uiState.valid) {
      this.uiState.appendLog('Submit blocked because the form is invalid.');
      this.cdr.detectChanges();
      return;
    }

    this.submittedPayload = formatProfileJson(this.formState.snapshot());
    this.uiState.draftStatus = 'saved';
    this.uiState.appendLog('Submitted a valid payload.');
    this.cdr.detectChanges();
  }

  toNumber(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  resetForm(): void {
    this.uiState.resetAll();
    this.submittedPayload = '';

    if (this.usernameValidationTimer) {
      clearTimeout(this.usernameValidationTimer);
      this.usernameValidationTimer = null;
    }

    this.cdr.detectChanges();
  }

  fieldError(path: TouchedPath): string | null {
    if (!this.shouldShowError(path)) {
      return null;
    }

    return readErrorAtPath(this.uiState.errors, path);
  }

  passwordError(): string | null {
    const hasInteraction =
      this.uiState.attemptedSubmit ||
      this.uiState.touchedFields.includes('security.password') ||
      this.uiState.touchedFields.includes('security.confirmPassword');

    if (!hasInteraction) {
      return null;
    }

    return this.uiState.errors.security.group;
  }

  private shouldShowError(path: TouchedPath): boolean {
    return (
      this.uiState.attemptedSubmit ||
      this.uiState.touchedFields.includes(path)
    );
  }

  private runUsernameValidation(): void {
    if (this.usernameValidationTimer) {
      clearTimeout(this.usernameValidationTimer);
      this.usernameValidationTimer = null;
    }

    const username = this.formState.profile.username.trim().toLowerCase();
    const syncError = validateUsernameSync(username);

    this.uiState.usernameTaken = false;
    this.uiState.usernamePending = false;

    if (syncError !== null || username.length === 0) {
      this.cdr.detectChanges();
      return;
    }

    const token = ++this.usernameValidationToken;
    this.uiState.usernamePending = true;
    this.cdr.detectChanges();

    this.usernameValidationTimer = setTimeout(() => {
      if (token !== this.usernameValidationToken) {
        return;
      }

      this.uiState.usernamePending = false;
      this.uiState.usernameTaken = RESERVED_USERNAMES.has(username);
      this.cdr.detectChanges();
    }, 300);
  }

  private startAutosave(): void {
    const autosave = pipe(
      this.uiState.at('saveRequest'),
      filter((snapshot) => snapshot !== null),
      debounce(650),
      tap(async (snapshot: ProfileFormValue | null) => {
        if (!snapshot) {
          return;
        }

        this.uiState.markSaving();
        this.cdr.detectChanges();

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
        this.cdr.detectChanges();
      }),
    ).subscribe(() => {});

    this.uiState.cleanups.add(() => autosave());
  }
}

function validateSnapshot(
  snapshot: ProfileFormValue,
  usernameTaken: boolean,
): StreamixErrors {
  const errors: StreamixErrors = {
    profile: {
      firstName: textRequired(snapshot.profile.firstName, 2),
      lastName: textRequired(snapshot.profile.lastName, 2),
      email: validateEmail(snapshot.profile.email),
      username: validateUsernameSync(snapshot.profile.username),
      bio: validateBio(snapshot.profile.bio),
    },
    security: {
      password: validatePassword(snapshot.security.password),
      confirmPassword: snapshot.security.confirmPassword.trim().length === 0
        ? 'This field is required.'
        : null,
      group: null,
    },
    address: {
      country: textRequired(snapshot.address.country),
      city: textRequired(snapshot.address.city),
      postalCode: validatePostalCode(snapshot.address.postalCode),
    },
    availability: {
      startDate: snapshot.availability.startDate.trim().length === 0
        ? 'This field is required.'
        : null,
      hoursPerWeek: validateHours(snapshot.availability.hoursPerWeek),
    },
    skills: snapshot.skills.map((skill) => ({
      name: textRequired(skill.name, 2),
      years: validateSkillYears(skill.years),
    })),
    summary: [],
  };

  if (errors.profile.username === null && usernameTaken) {
    errors.profile.username = 'That username is reserved for demos.';
  }

  if (
    snapshot.security.password.trim().length > 0 &&
    snapshot.security.confirmPassword.trim().length > 0 &&
    snapshot.security.password !== snapshot.security.confirmPassword
  ) {
    errors.security.group = 'Passwords must match.';
  }

  if (errors.profile.firstName || errors.profile.lastName || errors.profile.email || errors.profile.username || errors.profile.bio) {
    errors.summary.push('Profile details need cleanup.');
  }
  if (errors.security.password || errors.security.confirmPassword || errors.security.group) {
    errors.summary.push('Passwords are incomplete or mismatched.');
  }
  if (errors.address.country || errors.address.city || errors.address.postalCode) {
    errors.summary.push('Address information is incomplete.');
  }
  if (errors.availability.startDate || errors.availability.hoursPerWeek) {
    errors.summary.push('Availability is outside the allowed range.');
  }
  if (errors.skills.some((skill) => skill.name || skill.years)) {
    errors.summary.push('At least one valid skill entry is required.');
  }

  return errors;
}

function textRequired(value: string, minLength = 1): string | null {
  if (value.trim().length === 0) {
    return 'This field is required.';
  }

  if (value.trim().length < minLength) {
    return `Minimum length is ${minLength}.`;
  }

  return null;
}

function validateEmail(value: string): string | null {
  if (value.trim().length === 0) {
    return 'This field is required.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    return 'Use a valid email address.';
  }

  return null;
}

function validateUsernameSync(value: string): string | null {
  if (value.trim().length === 0) {
    return 'This field is required.';
  }

  if (value.trim().length < 3) {
    return 'Minimum length is 3.';
  }

  if (!/^[a-z0-9-]+$/.test(value.trim())) {
    return 'Format is invalid.';
  }

  return null;
}

function validateBio(value: string): string | null {
  if (value.trim().length === 0) {
    return 'This field is required.';
  }

  if (value.length > 240) {
    return 'Maximum length is 240.';
  }

  return null;
}

function validatePassword(value: string): string | null {
  if (value.trim().length === 0) {
    return 'This field is required.';
  }

  if (value.length < 8) {
    return 'Minimum length is 8.';
  }

  return null;
}

function validatePostalCode(value: string): string | null {
  if (value.trim().length === 0) {
    return 'This field is required.';
  }

  if (!POSTAL_CODE_PATTERN.test(value.trim())) {
    return 'Format is invalid.';
  }

  return null;
}

function validateHours(value: number): string | null {
  if (value < 10) {
    return 'Minimum value is 10.';
  }

  if (value > 60) {
    return 'Maximum value is 60.';
  }

  return null;
}

function validateSkillYears(value: number): string | null {
  if (value < 1) {
    return 'Minimum value is 1.';
  }

  if (value > 20) {
    return 'Maximum value is 20.';
  }

  return null;
}

function readErrorAtPath(errors: StreamixErrors, path: string): string | null {
  const parts = path.split('.');

  if (parts[0] === 'skills') {
    const index = Number(parts[1]);
    const key = parts[2] as 'name' | 'years';
    return errors.skills[index]?.[key] ?? null;
  }

  const group = parts[0] as 'profile' | 'security' | 'address' | 'availability';
  const key = parts[1] as string;
  const target = errors[group] as Record<string, string | null>;
  return target[key] ?? null;
}

function remapTouchedFieldsAfterSkillRemoval(
  fields: TouchedPath[],
  removedIndex: number,
): TouchedPath[] {
  return fields.flatMap((field) => {
    if (!field.startsWith('skills.')) {
      return [field];
    }

    const parts = field.split('.');
    const index = Number(parts[1]);
    const key = parts[2];

    if (index === removedIndex) {
      return [];
    }

    if (index > removedIndex) {
      return [`skills.${index - 1}.${key}`];
    }

    return [field];
  });
}
