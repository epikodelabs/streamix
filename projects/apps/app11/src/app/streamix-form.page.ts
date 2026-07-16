import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { debounce, filter, method, pipe, scope, tap } from '@epikodelabs/streamix';

import {
  calculateCompletion,
  formatProfileJson,
  getInitialProfileValue,
  type ContactMethod,
  type ProfileFormValue,
  type SkillValue,
  type ThemePreference,
} from './profile-model';

type DraftStatus = 'idle' | 'editing' | 'saving' | 'saved';
type TouchedPath = string;
type ValueKind = 'text' | 'number' | 'boolean';

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
interface StreamixUiShape {
  touchedFields: TouchedPath[];
  usernamePending: boolean;
  usernameTaken: boolean;
  attemptedSubmit: boolean;
  draftStatus: DraftStatus;
  lastSavedAt: string;
  saveRequest: ProfileFormValue | null;
  errors: StreamixErrors;
  valid: boolean;
  completion: number;
  primarySkills: string;
  readyToSubmit: boolean;
  preview: string;
  touchField: (path: TouchedPath) => void;
  queueChange: () => void;
  markSaving: () => void;
  markSaved: (timestamp: string) => void;
  setAttemptedSubmit: (value: boolean) => void;
  resetAll: () => void;
}

interface FieldConfig {
  path: TouchedPath;
  label: string;
  type: 'text' | 'email' | 'password' | 'date' | 'textarea' | 'number' | 'range';
  kind?: ValueKind;
  rows?: number;
  min?: number;
  max?: number;
}

interface SkillFieldConfig extends Omit<FieldConfig, 'path'> {
  key: Extract<keyof SkillValue, 'name' | 'years'>;
  compact?: boolean;
}

interface OptionConfig<T extends string> {
  label: string;
  value: T;
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

  readonly profileFields: FieldConfig[] = [
    { path: 'profile.firstName', label: 'First name', type: 'text' },
    { path: 'profile.lastName', label: 'Last name', type: 'text' },
    { path: 'profile.email', label: 'Email', type: 'email' },
    { path: 'profile.username', label: 'Username', type: 'text' },
    { path: 'profile.bio', label: 'Bio', type: 'textarea', rows: 4 },
  ];

  readonly securityFields: FieldConfig[] = [
    { path: 'security.password', label: 'Password', type: 'password' },
    { path: 'security.confirmPassword', label: 'Confirm password', type: 'password' },
  ];

  readonly addressFields: FieldConfig[] = [
    { path: 'address.country', label: 'Country', type: 'text' },
    { path: 'address.city', label: 'City', type: 'text' },
    { path: 'address.postalCode', label: 'Postal code', type: 'text' },
  ];

  readonly availabilityFields: FieldConfig[] = [
    { path: 'availability.startDate', label: 'Start date', type: 'date' },
    {
      path: 'availability.hoursPerWeek',
      label: 'Hours per week',
      type: 'range',
      kind: 'number',
      min: 10,
      max: 60,
    },
  ];

  readonly skillFields: SkillFieldConfig[] = [
    { key: 'name', label: 'Skill', type: 'text' },
    {
      key: 'years',
      label: 'Years',
      type: 'number',
      kind: 'number',
      min: 1,
      max: 20,
      compact: true,
    },
  ];

  readonly contactOptions: OptionConfig<ContactMethod>[] = [
    { label: 'Email', value: 'email' },
    { label: 'Phone', value: 'phone' },
    { label: 'Slack', value: 'slack' },
  ];

  readonly themeOptions: OptionConfig<ThemePreference>[] = [
    { label: 'System', value: 'system' },
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ];

  private readonly formState = scope<ProfileFormValue>(structuredClone(getInitialProfileValue()));

  private readonly uiState = scope<StreamixUiShape>(() => ({
    touchedFields: [] as TouchedPath[],
    usernamePending: false,
    usernameTaken: false,
    attemptedSubmit: false,
    draftStatus: 'idle',
    lastSavedAt: 'Not saved yet',
    saveRequest: null,
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
    touchField: method((self: any, path: TouchedPath) => {
      if (self.touchedFields.includes(path)) {
        return;
      }

      self.touchedFields = [...self.touchedFields, path];
    }),
    queueChange: method((self: any) => {
      self.draftStatus = 'editing';
      self.saveRequest = structuredClone(this.formState.snapshot());
    }),
    markSaving: method((self: any) => {
      self.draftStatus = 'saving';
    }),
    markSaved: method((self: any, timestamp: string) => {
      self.lastSavedAt = timestamp;
      self.draftStatus = 'saved';
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
      self.saveRequest = null;
    }),
  }));

  constructor() {
    this.startAutosave();
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

  get completion(): number {
    return this.uiState.completion;
  }

  get primarySkills(): string {
    return this.uiState.primarySkills;
  }

  get readyToSubmit(): boolean {
    return this.uiState.readyToSubmit;
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
    this.uiState.queueChange();
    this.cdr.detectChanges();
  }

  submit(event: Event): void {
    event.preventDefault();
    this.uiState.setAttemptedSubmit(true);

    if (!this.uiState.valid) {
      this.cdr.detectChanges();
      return;
    }

    this.submittedPayload = formatProfileJson(this.formState.snapshot());
    this.uiState.draftStatus = 'saved';
    this.cdr.detectChanges();
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
    if (path === 'profile.username' && this.usernamePending) {
      return null;
    }

    if (!this.shouldShowError(path)) {
      return null;
    }

    return readErrorAtPath(this.uiState.errors, path);
  }

  read(path: TouchedPath): string | number | boolean {
    return readPath(this.formState, path) as string | number | boolean;
  }

  update(path: TouchedPath, value: string | number | boolean): void {
    writePath(this.formState, path, value);

    if (path === 'profile.username') {
      this.uiState.usernameTaken = false;
      this.uiState.usernamePending = false;
    }

    this.uiState.queueChange();
    this.cdr.detectChanges();
  }

  updateFromEvent(
    path: TouchedPath,
    event: Event,
    kind: ValueKind = 'text',
  ): void {
    if (kind === 'boolean') {
      const target = event.target as HTMLInputElement;
      this.update(path, target.checked);
      return;
    }

    const target = event.target as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement;

    if (kind === 'number') {
      this.update(path, toNumber(target.value));
      return;
    }

    this.update(path, target.value);
  }

  skillPath(index: number, key: keyof SkillValue): TouchedPath {
    return `skills.${index}.${key}`;
  }

  fieldHint(path: TouchedPath): string | null {
    if (path === 'profile.username' && this.usernamePending) {
      return 'Checking username availability...';
    }

    if (path === 'availability.hoursPerWeek') {
      return `${this.read(path)} hrs/week`;
    }

    return null;
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

function readPath(source: any, path: string): unknown {
  return path.split('.').reduce((current, key) => current?.[key], source);
}

function writePath(
  source: any,
  path: string,
  value: string | number | boolean,
): void {
  const parts = path.split('.');

  if (parts[0] === 'skills') {
    const index = Number(parts[1]);
    const key = parts[2] as keyof SkillValue;
    const nextSkills = structuredClone(source.skills as SkillValue[]);
    (nextSkills[index] as any)[key] = value;
    source.skills = nextSkills;
    return;
  }

  const last = parts.pop()!;
  const target = parts.reduce((current, key) => current[key], source);
  target[last] = value;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
