import {
  calculateCompletion,
  formatProfileJson,
  getInitialProfileValue,
  type ProfileFormValue,
  type SkillValue,
} from "./profile-model";
import {
  abortableDelay,
  checks,
  field,
  form,
  list,
  syncList,
  type ValidationIssues
} from "./streamix-forms";

const RESERVED_USERNAMES = new Set(["admin", "angular", "root", "streamix"]);
const USERNAME_PATTERN = /^[a-z0-9-]+$/;
const POSTAL_CODE_PATTERN = /^[A-Z0-9 -]{4,10}$/i;

export type DraftStatus = "idle" | "editing" | "saving" | "saved";

export const contactOptions = [
  { label: "Email", value: "email" },
  { label: "Phone", value: "phone" },
  { label: "Slack", value: "slack" },
] as const;

export const themeOptions = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
] as const;

export type ProfileForm = ReturnType<typeof createProfileForm>;
export type SkillForm = ReturnType<typeof createSkill>;

export const cloneInitialProfile = (): ProfileFormValue =>
  structuredClone(getInitialProfileValue());

function text(value: string, minimum = 1) {
  return field(value, {
    checks: minimum > 1 ? [checks.required, checks.minLength(minimum)] : checks.required,
  });
}

export function createSkill(value: SkillValue = { name: "", years: 1, primary: false }) {
  return form({
    name: text(value.name, 2),
    years: field(value.years, { checks: [checks.min(1), checks.max(20)] }),
    primary: field(value.primary),
  });
}

/** Cross-field check: passwords must match when both are non-empty. */
function passwordMatchCheck(value: { password: string; confirmPassword: string }): ValidationIssues | null {
  const left = value.password.trim();
  const right = value.confirmPassword.trim();
  return left && right && left !== right ? { passwordMismatch: true } : null;
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
    security: form(
      {
        password: text(initial.security.password, 8),
        confirmPassword: field(initial.security.confirmPassword, { checks: checks.required }),
      },
      { checks: passwordMatchCheck },
    ),
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

export function profileSnapshot(formState: ProfileForm): ProfileFormValue {
  return formState.completeValue.value;
}

export function profileReady(formState: ProfileForm): boolean {
  const value = profileSnapshot(formState);
  return (
    formState.valid.value &&
    value.skills.length > 0 &&
    calculateCompletion(value) >= 85
  );
}

export function profilePreview(formState: ProfileForm): string {
  return formatProfileJson(profileSnapshot(formState));
}

export function primarySkills(formState: ProfileForm): string {
  return (
    profileSnapshot(formState).skills
      .filter(s => s.primary)
      .map(s => s.name.trim())
      .filter(Boolean)
      .join(", ") || "No primary skill selected"
  );
}

export function completion(formState: ProfileForm): number {
  return calculateCompletion(profileSnapshot(formState));
}

export function resetProfile(formState: ProfileForm, value = cloneInitialProfile()): void {
  syncList(formState.fields.skills, value.skills, createSkill);
  formState.reset(value, { updateInitial: true });
}

async function reservedUsername(value: string, signal: AbortSignal): Promise<ValidationIssues | null> {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || !USERNAME_PATTERN.test(normalized)) return null;

  await abortableDelay(300, signal);
  return RESERVED_USERNAMES.has(normalized) ? { usernameTaken: true } : null;
}