import { atom, type Subscription } from '@epikodelabs/streamix';

import { parseFormValue, type FormValuePrimitive } from './form-helpers';
import {
  addressFields,
  availabilityFields,
  contactOptions,
  profileFields,
  securityFields,
  skillFields,
  themeOptions,
  type DraftStatus,
  type FieldConfig,
  type PrimitiveValue,
  type ValueKind,
} from './streamix-form.config';
import {
  calculateCompletion,
  formatProfileJson,
  getInitialProfileValue,
  type ProfileFormValue,
  type SkillValue,
} from './profile-model';
import {
  checks,
  field,
  form,
  list,
  type Form,
  type FormNode,
  type List,
  type ValidationIssues,
} from './streamix-forms';

const POSTAL_CODE_PATTERN = /^[A-Z0-9 -]{4,10}$/i;
const RESERVED_USERNAMES = new Set(['admin', 'angular', 'root', 'streamix']);
const USERNAME_PATTERN = /^[a-z0-9-]+$/;
const SAVE_DELAY_MS = 650;
const SAVE_COMMIT_MS = 260;
const LAST_SAVED_LABEL = 'Not saved yet';

const issueMessages = Object.freeze({
  required: 'This field is required.',
  email: 'Use a valid email address.',
  pattern: 'Format is invalid.',
  usernameTaken: 'That username is reserved for demos.',
  invalid: 'Value is invalid.',
  validationFailed: 'Validation failed.',
  passwordMismatch: 'Passwords must match.',
});

type DemoField = FieldConfig & {
  readonly node: FormNode<any, any>;
  readonly pendingHint?: string;
  readonly valueHint?: (value: PrimitiveValue) => string | null;
};

type SkillNode = ReturnType<typeof createSkillNode>;
type ProfileFormNode = ReturnType<typeof createProfileFormNode>;

type DemoUiState = {
  readonly attemptedSubmit: boolean;
  readonly draftStatus: DraftStatus;
  readonly lastSavedAt: string;
  readonly errors: { readonly summary: string[] };
  readonly valid: boolean;
  readonly completion: number;
  readonly primarySkills: string;
  readonly readyToSubmit: boolean;
  readonly preview: string;
};

type FormNodes = ProfileFormNode['fields'];

export class StreamixFormDemoController {
  private readonly form = createProfileFormNode();
  private readonly attemptedSubmit = atom(false);
  private readonly draftStatus = atom<DraftStatus>('idle');
  private readonly lastSavedAt = atom(LAST_SAVED_LABEL);
  private readonly submittedPayloadState = atom('');
  private readonly subscriptions: Subscription[];

  private autosaveDebounce: ReturnType<typeof setTimeout> | null = null;
  private autosaveCommit: ReturnType<typeof setTimeout> | null = null;
  private autosaveToken = 0;

  readonly profileFields = bindFields(this.form, profileFields, {
    'profile.username': {
      pendingHint: 'Checking username availability...',
    },
  });

  readonly securityFields = bindFields(this.form, securityFields);
  readonly addressFields = bindFields(this.form, addressFields);
  readonly availabilityFields = bindFields(this.form, availabilityFields, {
    'availability.hoursPerWeek': {
      valueHint: (value) => `${value} hrs/week`,
    },
  });

  readonly skillFields = skillFields;
  readonly contactOptions = contactOptions;
  readonly themeOptions = themeOptions;
  readonly preferences = this.form.fields.preferences.fields;
  readonly availability = this.form.fields.availability.fields;

  constructor(private readonly onChange: () => void = () => {}) {
    this.subscriptions = [
      this.form.completeValue.subscribe(this.onChange),
      this.form.issues.subscribe(this.onChange),
      this.form.pending.subscribe(this.onChange),
      this.form.status.subscribe(this.onChange),
      this.attemptedSubmit.subscribe(this.onChange),
      this.draftStatus.subscribe(this.onChange),
      this.lastSavedAt.subscribe(this.onChange),
      this.submittedPayloadState.subscribe(this.onChange),
    ];
  }

  get skills(): readonly SkillNode[] {
    return this.form.fields.skills.items;
  }

  get submittedPayload(): string {
    return this.submittedPayloadState.value;
  }

  get uiState(): DemoUiState {
    const snapshot = this.snapshot;
    const valid = isFormValid(this.form);
    const completion = calculateCompletion(snapshot);

    return {
      attemptedSubmit: this.attemptedSubmit.value,
      draftStatus: this.draftStatus.value,
      lastSavedAt: this.lastSavedAt.value,
      errors: getSummary(this.form),
      valid,
      completion,
      primarySkills: formatPrimarySkills(snapshot.skills),
      readyToSubmit: valid && completion >= 85 && this.skills.length > 0,
      preview: formatProfileJson(snapshot),
    };
  }

  get valueOf(): (node: FormNode<any, any>) => PrimitiveValue {
    return valueOfNode;
  }

  dispose(): void {
    this.clearAutosave();
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.form.dispose();
  }

  submit(event: Event): void {
    event.preventDefault();
    this.attemptedSubmit.set(true);

    if (!isFormValid(this.form)) {
      this.onChange();
      return;
    }

    this.submittedPayloadState.set(formatProfileJson(structuredClone(this.snapshot)));
    this.draftStatus.set('saved');
    this.onChange();
  }

  resetForm(): void {
    const initial = cloneInitialValue();

    this.form.reset(initial, { updateInitial: true });
    syncSkillList(this.form.fields.skills, initial.skills);
    this.attemptedSubmit.set(false);
    this.draftStatus.set('idle');
    this.lastSavedAt.set(LAST_SAVED_LABEL);
    this.submittedPayloadState.set('');
    this.clearAutosave();
    this.onChange();
  }

  addSkill(): void {
    this.form.fields.skills.push(createSkillNode());
    this.queueAutosave();
    this.onChange();
  }

  removeSkill(index: number): void {
    if (this.skills.length === 1) {
      return;
    }

    this.form.fields.skills.removeAt(index);
    this.queueAutosave();
    this.onChange();
  }

  touchNode(node: FormNode<any, any>): void {
    node.touch();
    this.onChange();
  }

  updateNode(node: FormNode<any, any>, value: PrimitiveValue): void {
    node.set(value as never);
    this.queueAutosave();
    this.onChange();
  }

  updateNodeFromEvent(
    node: FormNode<any, any>,
    event: Event,
    kind: ValueKind = 'text',
  ): void {
    this.updateNode(node, parseFormValue(event, kind));
  }

  fieldError(field: DemoField): string | null {
    return getNodeError(
      field.node,
      this.attemptedSubmit.value,
      Boolean(field.pendingHint),
    );
  }

  nodeError(node: FormNode<any, any>): string | null {
    return getNodeError(node, this.attemptedSubmit.value);
  }

  fieldHint(field: DemoField): string | null {
    if (field.pendingHint && field.node.pending.value) {
      return field.pendingHint;
    }

    return field.valueHint?.(valueOfNode(field.node)) ?? null;
  }

  passwordError(): string | null {
    const { password, confirmPassword } = this.form.fields.security.fields;

    if (
      !this.attemptedSubmit.value
      && !password.touched.value
      && !confirmPassword.touched.value
    ) {
      return null;
    }

    return passwordMismatch(this.snapshot);
  }

  private get snapshot(): ProfileFormValue {
    return this.form.completeValue.value;
  }

  private queueAutosave(): void {
    const token = ++this.autosaveToken;

    this.draftStatus.set('editing');
    this.clearAutosave();

    this.autosaveDebounce = setTimeout(() => {
      if (token !== this.autosaveToken) {
        return;
      }

      this.draftStatus.set('saving');
      this.onChange();

      this.autosaveCommit = setTimeout(() => {
        if (token !== this.autosaveToken) {
          return;
        }

        this.lastSavedAt.set(new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }));
        this.draftStatus.set('saved');
        this.onChange();
      }, SAVE_COMMIT_MS);
    }, SAVE_DELAY_MS);
  }

  private clearAutosave(): void {
    if (this.autosaveDebounce) {
      clearTimeout(this.autosaveDebounce);
      this.autosaveDebounce = null;
    }
    if (this.autosaveCommit) {
      clearTimeout(this.autosaveCommit);
      this.autosaveCommit = null;
    }
  }
}

export function createStreamixFormDemo(
  onChange?: () => void,
): StreamixFormDemoController {
  return new StreamixFormDemoController(onChange);
}

function cloneInitialValue(): ProfileFormValue {
  return structuredClone(getInitialProfileValue());
}

function createProfileFormNode(
  value: ProfileFormValue = cloneInitialValue(),
) {
  return form({
    profile: form({
      firstName: textField(value.profile.firstName, 2),
      lastName: textField(value.profile.lastName, 2),
      email: field(value.profile.email, { checks: [checks.required, checks.email] }),
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
      password: textField(value.security.password, 8),
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
      hoursPerWeek: numberField(value.availability.hoursPerWeek, 10, 60),
      remote: field(value.availability.remote),
    }),
    skills: list(value.skills.map(createSkillNode)),
  });
}

function createSkillNode(
  value: SkillValue = { name: '', years: 1, primary: false },
) {
  return form({
    name: textField(value.name, 2),
    years: numberField(value.years, 1, 20),
    primary: field(value.primary),
  });
}

function textField(value: string, minLength = 1) {
  return field(value, {
    checks: minLength > 1
      ? [checks.required, checks.minLength(minLength)]
      : checks.required,
  });
}

function numberField(value: number, min: number, max: number) {
  return field(value, { checks: [checks.min(min), checks.max(max)] });
}

function bindFields(
  root: ProfileFormNode,
  defs: readonly FieldConfig[],
  extras: Partial<Record<string, Omit<DemoField, keyof FieldConfig | 'node'>>> = {},
): readonly DemoField[] {
  return defs.map((def) => ({
    ...def,
    node: readNode(root, def.path),
    ...extras[def.path],
  }));
}

function valueOfNode(node: FormNode<any, any>): PrimitiveValue {
  return node.completeValue.value as FormValuePrimitive;
}

function syncSkillList(
  skills: FormNodes['skills'],
  next: readonly SkillValue[],
): void {
  while (skills.items.length > next.length) {
    skills.removeAt(skills.items.length - 1);
  }

  while (skills.items.length < next.length) {
    skills.push(createSkillNode(next[skills.items.length]));
  }

  skills.items.forEach((skill, index) => {
    skill.reset(next[index], { updateInitial: true });
  });
}

function readNode(root: ProfileFormNode, path: string): FormNode<any, any> {
  let current: FormNode<any, any> = root;

  for (const segment of path.split('.')) {
    if (/^\d+$/.test(segment)) {
      current = (current as List<FormNode<any, any>>).items[Number(segment)];
      continue;
    }

    current = (current as Form<Record<string, FormNode<any, any>>>).fields[segment];
  }

  return current;
}

function getNodeError(
  node: FormNode<any, any>,
  attemptedSubmit: boolean,
  suppressWhilePending = false,
): string | null {
  if (
    (suppressWhilePending && node.pending.value)
    || (!attemptedSubmit && !node.touched.value)
  ) {
    return null;
  }

  return issueToMessage(node.issues.value)
    || (node.validationError.value !== null ? issueMessages.validationFailed : null);
}

function getSummary(formState: ProfileFormNode): { readonly summary: string[] } {
  const { profile, security, address, availability, skills } = formState.fields;
  const summary: string[] = [];

  summarize(
    summary,
    hasIssues(
      profile.fields.firstName,
      profile.fields.lastName,
      profile.fields.email,
      profile.fields.username,
      profile.fields.bio,
    ),
    'Profile details need cleanup.',
  );
  summarize(
    summary,
    hasIssues(
      security.fields.password,
      security.fields.confirmPassword,
    ) || passwordMismatch(formState.completeValue.value) !== null,
    'Passwords are incomplete or mismatched.',
  );
  summarize(
    summary,
    hasIssues(
      address.fields.country,
      address.fields.city,
      address.fields.postalCode,
    ),
    'Address information is incomplete.',
  );
  summarize(
    summary,
    hasIssues(
      availability.fields.startDate,
      availability.fields.hoursPerWeek,
    ),
    'Availability is outside the allowed range.',
  );
  summarize(
    summary,
    skills.items.length === 0
      || skills.items.some((skill) =>
        hasIssues(skill.fields.name, skill.fields.years)),
    'At least one valid skill entry is required.',
  );

  return { summary };
}

function hasIssues(...nodes: readonly FormNode<any, any>[]): boolean {
  return nodes.some((node) =>
    node.issues.value !== null || node.validationError.value !== null,
  );
}

function isFormValid(formState: ProfileFormNode): boolean {
  return formState.valid.value
    && passwordMismatch(formState.completeValue.value) === null
    && formState.fields.skills.items.length > 0;
}

function formatPrimarySkills(skills: readonly SkillValue[]): string {
  return skills
    .filter((skill) => skill.primary)
    .map((skill) => skill.name.trim())
    .filter(Boolean)
    .join(', ') || 'No primary skill selected';
}

function passwordMismatch(value: ProfileFormValue): string | null {
  return value.security.password.trim().length > 0
    && value.security.confirmPassword.trim().length > 0
    && value.security.password !== value.security.confirmPassword
    ? issueMessages.passwordMismatch
    : null;
}

function summarize(summary: string[], invalid: boolean, message: string): void {
  if (invalid) {
    summary.push(message);
  }
}

function issueToMessage(issues: ValidationIssues | null): string | null {
  if (!issues) {
    return null;
  }

  const [name, payload] = Object.entries(issues)[0] ?? [];

  switch (name) {
    case 'required':
    case 'email':
    case 'pattern':
    case 'usernameTaken':
      return issueMessages[name];
    case 'minLength':
    case 'maxLength':
    case 'min':
    case 'max':
      return `${name.startsWith('max') ? 'Maximum' : 'Minimum'} ${
        name.endsWith('Length') ? 'length' : 'value'
      } is ${readRequired(payload)}.`;
    default:
      return issueMessages.invalid;
  }
}

function readRequired(payload: unknown): number | string {
  return typeof payload === 'object' && payload !== null && 'required' in payload
    ? (payload as { required: number | string }).required
    : '0';
}

async function reservedUsernameCheck(
  value: string,
  signal: AbortSignal,
): Promise<ValidationIssues | null> {
  const normalized = value.trim().toLowerCase();

  if (
    normalized.length < 3
    || !USERNAME_PATTERN.test(normalized)
  ) {
    return null;
  }

  await delay(SAVE_COMMIT_MS + 40, signal);
  return RESERVED_USERNAMES.has(normalized) ? { usernameTaken: true } : null;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);

    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      resolve();
    };

    signal.addEventListener('abort', cancel, { once: true });
  });
}
