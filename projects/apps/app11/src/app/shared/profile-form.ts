import {
  calculateCompletion,
  formatProfileJson,
  getInitialProfileValue,
  type ProfileFormValue,
  type SkillValue,
} from './profile-model';
import {
  checks, field, form, list,
  type Field, type ValidationIssues,
} from './streamix-forms';

const RESERVED_USERNAMES = new Set(['admin', 'angular', 'root', 'streamix']);
const USERNAME_PATTERN = /^[a-z0-9-]+$/;
const POSTAL_CODE_PATTERN = /^[A-Z0-9 -]{4,10}$/i;

const fieldMessages: Readonly<Record<string, string>> = Object.freeze({
  required: 'This field is required.',
  email: 'Use a valid email address.',
  pattern: 'Format is invalid.',
  usernameTaken: 'That username is reserved for demos.',
  passwordMismatch: 'Passwords must match.',
});

const RANGE_KEYS = new Set(['minLength', 'maxLength', 'min', 'max']);

export type DraftStatus = 'idle' | 'editing' | 'saving' | 'saved';

export const contactOptions = [
  { label: 'Email', value: 'email' },
  { label: 'Phone', value: 'phone' },
  { label: 'Slack', value: 'slack' },
] as const;

export const themeOptions = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
] as const;

export type FieldInputType = 'text' | 'email' | 'password' | 'date' | 'textarea' | 'number' | 'range';

export interface FieldView<T = unknown> {
  readonly node: Field<T>;
  readonly label: string;
  readonly type?: FieldInputType;
  readonly rows?: number;
  readonly min?: number;
  readonly max?: number;
  readonly compact?: boolean;
  readonly pendingHint?: string;
  readonly hint?: (value: T) => string | null;
}

export type ProfileForm = ReturnType<typeof createProfileForm>;
export type SkillForm = ReturnType<typeof createSkill>;

export const cloneInitialProfile = (): ProfileFormValue => structuredClone(getInitialProfileValue());

function text(value: string, minimum = 1) {
  return field(value, {
    checks: minimum > 1 ? [checks.required, checks.minLength(minimum)] : checks.required,
  });
}

export function createSkill(value: SkillValue = { name: '', years: 1, primary: false }) {
  return form({
    name: text(value.name, 2),
    years: field(value.years, { checks: [checks.min(1), checks.max(20)] }),
    primary: field(value.primary),
  });
}

export function createProfileForm(initial: ProfileFormValue = cloneInitialProfile()) {
  return form({
    profile: form({
      firstName: text(initial.profile.firstName, 2),
      lastName: text(initial.profile.lastName, 2),
      email: field(initial.profile.email, { checks: [checks.required, checks.email] }),
      username: field(initial.profile.username, {
        checks: [checks.required, checks.minLength(3), checks.pattern(USERNAME_PATTERN)],
        asyncChecks: reservedUsername,
        asyncDelay: 250,
      }),
      bio: field(initial.profile.bio, { checks: [checks.required, checks.maxLength(240)] }),
    }),
    security: form({
      password: text(initial.security.password, 8),
      confirmPassword: field(initial.security.confirmPassword, { checks: checks.required }),
    }),
    address: form({
      country: field(initial.address.country, { checks: checks.required }),
      city: field(initial.address.city, { checks: checks.required }),
      postalCode: field(initial.address.postalCode, {
        checks: [checks.required, checks.pattern(POSTAL_CODE_PATTERN)],
      }),
    }),
    preferences: form({
      contactMethod: field(initial.preferences.contactMethod),
      theme: field(initial.preferences.theme),
      newsletter: field(initial.preferences.newsletter),
    }),
    availability: form({
      startDate: field(initial.availability.startDate, { checks: checks.required }),
      hoursPerWeek: field(initial.availability.hoursPerWeek, { checks: [checks.min(10), checks.max(60)] }),
      remote: field(initial.availability.remote),
    }),
    skills: list(initial.skills.map(createSkill)),
  });
}

function view<T>(
  node: Field<T>,
  label: string,
  type: FieldView<T>['type'] = 'text',
  extras: Omit<FieldView<T>, 'node' | 'label' | 'type'> = {},
): FieldView<T> {
  return { node, label, type, ...extras };
}

export function createFieldViews(formState: ProfileForm) {
  const { profile, security, address, availability } = formState.fields;
  return {
    profile: [
      view(profile.fields.firstName, 'First name'),
      view(profile.fields.lastName, 'Last name'),
      view(profile.fields.email, 'Email', 'email'),
      view(profile.fields.username, 'Username', 'text', { pendingHint: 'Checking username availability...' }),
      view(profile.fields.bio, 'Bio', 'textarea', { rows: 4 }),
    ],
    security: [
      view(security.fields.password, 'Password', 'password'),
      view(security.fields.confirmPassword, 'Confirm password', 'password'),
    ],
    address: [
      view(address.fields.country, 'Country'),
      view(address.fields.city, 'City'),
      view(address.fields.postalCode, 'Postal code'),
    ],
    availability: [
      view(availability.fields.startDate, 'Start date', 'date'),
      view(availability.fields.hoursPerWeek, 'Hours per week', 'range', {
        min: 10, max: 60, hint: value => `${value} hrs/week`,
      }),
    ],
  };
}

export function skillNameView(skill: SkillForm): FieldView<string> {
  return view(skill.fields.name, 'Skill', 'text');
}

export function skillYearsView(skill: SkillForm): FieldView<number> {
  return view(skill.fields.years, 'Years', 'number', { min: 1, max: 20, compact: true });
}

export function fieldHint(v: FieldView<any>): string | null {
  if (v.pendingHint && v.node.pending.value) return v.pendingHint;
  return v.hint?.(v.node.completeValue.value) ?? null;
}

export function fieldError(v: FieldView<any>): string | null {
  const { node, pendingHint } = v;
  if ((pendingHint && node.pending.value) || !node.touched.value) return null;
  if (node.validationError.value !== null) return 'Validation failed.';

  const issues = node.issues.value;
  if (!issues) return null;

  const [name, payload] = Object.entries(issues)[0] ?? [];
  if (!name) return null;
  if (fieldMessages[name]) return fieldMessages[name];

  if (RANGE_KEYS.has(name)) {
    const required = typeof payload === 'object' && payload !== null && 'required' in payload
      ? String((payload as { required: unknown }).required) : '';
    return `${name.startsWith('max') ? 'Maximum' : 'Minimum'} ${name.endsWith('Length') ? 'length' : 'value'} is ${required}.`;
  }

  return 'Value is invalid.';
}

export function profileSnapshot(formState: ProfileForm): ProfileFormValue {
  return formState.completeValue.value;
}

export function passwordMismatch(formState: ProfileForm): ValidationIssues | null {
  const { password, confirmPassword } = formState.fields.security.fields;
  const left = password.completeValue.value.trim();
  const right = confirmPassword.completeValue.value.trim();
  return left && right && left !== right ? { passwordMismatch: true } : null;
}

export function profileReady(formState: ProfileForm): boolean {
  const value = profileSnapshot(formState);
  return formState.valid.value
    && passwordMismatch(formState) === null
    && value.skills.length > 0
    && calculateCompletion(value) >= 85;
}

export function profilePreview(formState: ProfileForm): string {
  return formatProfileJson(profileSnapshot(formState));
}

export function primarySkills(formState: ProfileForm): string {
  return profileSnapshot(formState).skills
    .filter(s => s.primary)
    .map(s => s.name.trim())
    .filter(Boolean)
    .join(', ') || 'No primary skill selected';
}

export function completion(formState: ProfileForm): number {
  return calculateCompletion(profileSnapshot(formState));
}

function syncSkills(formState: ProfileForm, next: readonly SkillValue[]): void {
  const skills = formState.fields.skills;
  const target = next.length;

  while (skills.items.length > target) skills.removeAt(skills.items.length - 1);
  while (skills.items.length < target) skills.push(createSkill(next[skills.items.length]));
}

export function resetProfile(formState: ProfileForm, value = cloneInitialProfile()): void {
  syncSkills(formState, value.skills);
  formState.reset(value, { updateInitial: true });
}

async function reservedUsername(value: string, signal: AbortSignal): Promise<ValidationIssues | null> {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || !USERNAME_PATTERN.test(normalized)) return null;

  await abortableDelay(300, signal);
  return RESERVED_USERNAMES.has(normalized) ? { usernameTaken: true } : null;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
  });
}