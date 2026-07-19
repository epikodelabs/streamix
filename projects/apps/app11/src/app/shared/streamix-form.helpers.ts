import { createIndexedFieldPath, parseFormValue } from './form-helpers';
import {
  type ProfileFormValue,
  type SkillValue,
  getInitialProfileValue,
} from './profile-model';
export {
  addressFields,
  availabilityFields,
  contactOptions,
  profileFields,
  securityFields,
  skillFields,
  themeOptions,
  type DraftStatus,
  type FieldConfig,
  type FieldType,
  type OptionConfig,
  type PrimitiveValue,
  type SkillFieldConfig,
  type TouchedPath,
  type ValueKind,
} from './streamix-form.config';
import {
  type PrimitiveValue,
  type TouchedPath,
  type ValueKind,
} from './streamix-form.config';
import {
  checks,
  field,
  form,
  list,
  type Field,
  type Form,
  type FormNode,
  type List,
  type ValidationIssues,
} from './streamix-forms';

const POSTAL_CODE_PATTERN = /^[A-Z0-9 -]{4,10}$/i;
const RESERVED_USERNAMES = new Set(['admin', 'angular', 'root', 'streamix']);
const USERNAME_PATTERN = /^[a-z0-9-]+$/;

type ProfileGroupNode = Form<{
  firstName: Field<string>;
  lastName: Field<string>;
  email: Field<string>;
  username: Field<string>;
  bio: Field<string>;
}>;

type SecurityGroupNode = Form<{
  password: Field<string>;
  confirmPassword: Field<string>;
}>;

type AddressGroupNode = Form<{
  country: Field<string>;
  city: Field<string>;
  postalCode: Field<string>;
}>;

type PreferencesGroupNode = Form<{
  contactMethod: Field<ProfileFormValue['preferences']['contactMethod']>;
  theme: Field<ProfileFormValue['preferences']['theme']>;
  newsletter: Field<boolean>;
}>;

type AvailabilityGroupNode = Form<{
  startDate: Field<string>;
  hoursPerWeek: Field<number>;
  remote: Field<boolean>;
}>;

export type SkillFormNode = Form<{
  name: Field<string>;
  years: Field<number>;
  primary: Field<boolean>;
}>;

export type ProfileStreamixForm = Form<{
  profile: ProfileGroupNode;
  security: SecurityGroupNode;
  address: AddressGroupNode;
  preferences: PreferencesGroupNode;
  availability: AvailabilityGroupNode;
  skills: List<SkillFormNode>;
}>;

export interface StreamixSummary {
  readonly summary: string[];
}

export function cloneInitialProfileValue(): ProfileFormValue {
  return structuredClone(getInitialProfileValue());
}

export function createEmptySkill(): SkillValue {
  return { name: '', years: 1, primary: false };
}

export function createProfileStreamixForm(
  value: ProfileFormValue = cloneInitialProfileValue(),
): ProfileStreamixForm {
  return form({
    profile: form({
      firstName: field(value.profile.firstName, {
        checks: [checks.required, checks.minLength(2)],
      }),
      lastName: field(value.profile.lastName, {
        checks: [checks.required, checks.minLength(2)],
      }),
      email: field(value.profile.email, {
        checks: [checks.required, checks.email],
      }),
      username: field(value.profile.username, {
        checks: [
          checks.required,
          checks.minLength(3),
          checks.pattern(USERNAME_PATTERN),
        ],
        asyncChecks: reservedUsernameCheck,
      }),
      bio: field(value.profile.bio, {
        checks: [checks.required, checks.maxLength(240)],
      }),
    }),
    security: form({
      password: field(value.security.password, {
        checks: [checks.required, checks.minLength(8)],
      }),
      confirmPassword: field(value.security.confirmPassword, {
        checks: checks.required,
      }),
    }),
    address: form({
      country: field(value.address.country, { checks: checks.required }),
      city: field(value.address.city, { checks: checks.required }),
      postalCode: field(value.address.postalCode, {
        checks: [checks.required, checks.pattern(POSTAL_CODE_PATTERN)],
      }),
    }),
    preferences: form({
      contactMethod: field(value.preferences.contactMethod),
      theme: field(value.preferences.theme),
      newsletter: field(value.preferences.newsletter),
    }),
    availability: form({
      startDate: field(value.availability.startDate, { checks: checks.required }),
      hoursPerWeek: field(value.availability.hoursPerWeek, {
        checks: [checks.min(10), checks.max(60)],
      }),
      remote: field(value.availability.remote),
    }),
    skills: list(value.skills.map((skill) => createSkillFormNode(skill))),
  });
}

export function createSkillFormNode(
  value: SkillValue = createEmptySkill(),
): SkillFormNode {
  return form({
    name: field(value.name, {
      checks: [checks.required, checks.minLength(2)],
    }),
    years: field(value.years, {
      checks: [checks.min(1), checks.max(20)],
    }),
    primary: field(value.primary),
  });
}

export function readPath(
  formState: ProfileStreamixForm,
  path: TouchedPath,
): PrimitiveValue {
  return readNode(formState, path).completeValue.value as PrimitiveValue;
}

export function touchPath(
  formState: ProfileStreamixForm,
  path: TouchedPath,
): void {
  readNode(formState, path).touch();
}

export function writePath(
  formState: ProfileStreamixForm,
  path: TouchedPath,
  value: PrimitiveValue,
): void {
  readNode(formState, path).set(value as never);
}

export function applyStreamixUpdate(
  formState: ProfileStreamixForm,
  path: TouchedPath,
  value: PrimitiveValue,
): void {
  writePath(formState, path, value);
}

export function parseEventValue(
  event: Event,
  kind: ValueKind = 'text',
): PrimitiveValue {
  return parseFormValue(event, kind);
}

export function skillPath(
  index: number,
  key: keyof SkillValue,
): TouchedPath {
  return createIndexedFieldPath('skills', index, String(key));
}

export function removeSkill(
  formState: ProfileStreamixForm,
  index: number,
): void {
  if (formState.fields.skills.items.length === 1) {
    return;
  }

  formState.fields.skills.removeAt(index);
}

export function resetProfileForm(
  formState: ProfileStreamixForm,
  value: ProfileFormValue = cloneInitialProfileValue(),
): void {
  formState.fields.profile.reset(value.profile, { updateInitial: true });
  formState.fields.security.reset(value.security, { updateInitial: true });
  formState.fields.address.reset(value.address, { updateInitial: true });
  formState.fields.preferences.reset(value.preferences, { updateInitial: true });
  formState.fields.availability.reset(value.availability, { updateInitial: true });

  syncSkills(formState.fields.skills, value.skills);
}

export function getFieldHint(
  formState: ProfileStreamixForm,
  path: TouchedPath,
): string | null {
  const node = readNode(formState, path);

  if (path === 'profile.username' && node.pending.value) {
    return 'Checking username availability...';
  }

  return path === 'availability.hoursPerWeek'
    ? `${node.completeValue.value} hrs/week`
    : null;
}

export function getFieldError(
  formState: ProfileStreamixForm,
  path: TouchedPath,
  attemptedSubmit: boolean,
): string | null {
  return getNodeError(readNode(formState, path), attemptedSubmit, path === 'profile.username');
}

export function getNodeError(
  node: FormNode<any, any>,
  attemptedSubmit: boolean,
  suppressWhilePending = false,
): string | null {
  if ((suppressWhilePending && node.pending.value) || (!attemptedSubmit && !node.touched.value)) {
    return null;
  }

  return (
    issueToMessage(node.issues.value) ||
    (node.validationError.value !== null ? 'Validation failed.' : null)
  );
}

export function getPasswordError(
  formState: ProfileStreamixForm,
  attemptedSubmit: boolean,
): string | null {
  const security = formState.fields.security.fields;
  const showError = attemptedSubmit
    || security.password.touched.value
    || security.confirmPassword.touched.value;

  return showError ? passwordMismatch(formState.completeValue.value) : null;
}

export function getSummary(
  formState: ProfileStreamixForm,
): StreamixSummary {
  const profile = formState.fields.profile.fields;
  const security = formState.fields.security.fields;
  const address = formState.fields.address.fields;
  const availability = formState.fields.availability.fields;
  const skills = formState.fields.skills.items;
  const summary: string[] = [];

  pushSummary(
    summary,
    hasAnyIssue([
      profile.firstName,
      profile.lastName,
      profile.email,
      profile.username,
      profile.bio,
    ]),
    'Profile details need cleanup.',
  );
  pushSummary(
    summary,
    hasAnyIssue([security.password, security.confirmPassword])
      || passwordMismatch(formState.completeValue.value) !== null,
    'Passwords are incomplete or mismatched.',
  );
  pushSummary(
    summary,
    hasAnyIssue([address.country, address.city, address.postalCode]),
    'Address information is incomplete.',
  );
  pushSummary(
    summary,
    hasAnyIssue([availability.startDate, availability.hoursPerWeek]),
    'Availability is outside the allowed range.',
  );
  pushSummary(
    summary,
    skills.length === 0
      || skills.some((skill) => hasAnyIssue([skill.fields.name, skill.fields.years])),
    'At least one valid skill entry is required.',
  );

  return { summary };
}

export function isFormValid(formState: ProfileStreamixForm): boolean {
  return formState.valid.value
    && passwordMismatch(formState.completeValue.value) === null
    && formState.fields.skills.items.length > 0;
}

export function getPrimarySkills(formState: ProfileStreamixForm): string {
  return (
    formState.completeValue.value.skills
      .filter((skill) => skill.primary)
      .map((skill) => skill.name.trim())
      .filter(Boolean)
      .join(', ') || 'No primary skill selected'
  );
}

async function reservedUsernameCheck(
  value: string,
  signal: AbortSignal,
): Promise<ValidationIssues | null> {
  const normalized = value.trim().toLowerCase();

  if (normalized.length === 0 || !USERNAME_PATTERN.test(normalized) || normalized.length < 3) {
    return null;
  }

  await delay(300, signal);

  return RESERVED_USERNAMES.has(normalized) ? { usernameTaken: true } : null;
}

function syncSkills(
  skillsNode: List<SkillFormNode>,
  nextSkills: readonly SkillValue[],
): void {
  while (skillsNode.items.length > nextSkills.length) {
    skillsNode.removeAt(skillsNode.items.length - 1);
  }

  while (skillsNode.items.length < nextSkills.length) {
    skillsNode.push(createSkillFormNode(nextSkills[skillsNode.items.length]));
  }

  skillsNode.items.forEach((skill, index) => {
    skill.reset(nextSkills[index], { updateInitial: true });
  });
}

function readNode(
  formState: ProfileStreamixForm,
  path: string,
): FormNode<any, any> {
  let current: FormNode<any, any> = formState;

  for (const segment of path.split('.')) {
    if (/^\d+$/.test(segment)) {
      if (current.kind !== 'list') {
        throw new Error(`Expected list segment before index "${segment}".`);
      }

      const next = (current as List<FormNode<any, any>>).items[Number(segment)];

      if (!next) {
        throw new Error(`Unknown list index "${segment}" in "${path}".`);
      }

      current = next;
      continue;
    }

    if (current.kind !== 'form') {
      throw new Error(`Expected object segment "${segment}" in "${path}".`);
    }

    const next = (current as Form<Record<string, FormNode<any, any>>>).fields[segment];

    if (!next) {
      throw new Error(`Unknown field "${segment}" in "${path}".`);
    }

    current = next;
  }

  return current;
}

function hasAnyIssue(nodes: readonly FormNode<any, any>[]): boolean {
  return nodes.some((node) =>
    node.issues.value !== null || node.validationError.value !== null,
  );
}

function issueToMessage(issues: ValidationIssues | null): string | null {
  if (!issues) {
    return null;
  }

  const [name, payload] = Object.entries(issues)[0] ?? [];

  switch (name) {
    case 'required':
      return 'This field is required.';
    case 'email':
      return 'Use a valid email address.';
    case 'minLength':
      return `Minimum length is ${readConstraint(payload, 'required')}.`;
    case 'maxLength':
      return `Maximum length is ${readConstraint(payload, 'required')}.`;
    case 'min':
      return `Minimum value is ${readConstraint(payload, 'required')}.`;
    case 'max':
      return `Maximum value is ${readConstraint(payload, 'required')}.`;
    case 'pattern':
      return 'Format is invalid.';
    case 'usernameTaken':
      return 'That username is reserved for demos.';
    default:
      return 'Value is invalid.';
  }
}

function readConstraint(payload: unknown, key: 'required'): number | string {
  return typeof payload === 'object' && payload !== null && key in payload
    ? (payload as Record<'required', number | string>).required
    : '0';
}

function passwordMismatch(value: ProfileFormValue): string | null {
  return value.security.password.trim().length > 0
    && value.security.confirmPassword.trim().length > 0
    && value.security.password !== value.security.confirmPassword
    ? 'Passwords must match.'
    : null;
}

function pushSummary(summary: string[], invalid: boolean, message: string): void {
  if (invalid) {
    summary.push(message);
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);

    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve();
    };

    signal.addEventListener('abort', abort, { once: true });
  });
}
