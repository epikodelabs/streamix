import {
  abortableDelay,
  field,
  form,
  list,
  syncList,
  type ValidationIssues,
} from "@epikodelabs/streamix/forms";
import {
  getInitialProfileValue,
  type ProfileFormValue,
  type SkillValue,
} from "./profile-model";

const RESERVED_USERNAMES = new Set(["admin", "angular", "root", "streamix"]);
const USERNAME_PATTERN = /^[a-z0-9-]+$/;

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

export const cloneInitialProfile = (): ProfileFormValue =>
  structuredClone(getInitialProfileValue());

export function createSkill(value: SkillValue = { name: "", years: 1, primary: false }) {
  return form({
    name: field(value.name),
    years: field(value.years),
    primary: field(value.primary),
  });
}

/** Cross-field check: passwords must match when both are non-empty. */
export function passwordMatchCheck(value: { password: string; confirmPassword: string }): ValidationIssues | null {
  const left = value.password;
  const right = value.confirmPassword;
  return left && right && left !== right ? { passwordMismatch: true } : null;
}

export async function reservedUsername(value: string, signal: AbortSignal): Promise<ValidationIssues | null> {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || !USERNAME_PATTERN.test(normalized)) return null;

  await abortableDelay(300, signal);
  if (signal.aborted) return null;

  return RESERVED_USERNAMES.has(normalized) ? { usernameTaken: true } : null;
}

export function createProfileForm(
  initial: ProfileFormValue = cloneInitialProfile(),
) {
  return form({
    profile: form({
      firstName: field(initial.profile.firstName),
      lastName: field(initial.profile.lastName),
      email: field(initial.profile.email),
      username: field(initial.profile.username),
      bio: field(initial.profile.bio),
    }),

    security: form({
      password: field(initial.security.password),
      confirmPassword: field(
        initial.security.confirmPassword,
      ),
    }),

    address: form({
      country: field(initial.address.country),
      city: field(initial.address.city),
      postalCode: field(initial.address.postalCode),
    }),

    preferences: form({
      contactMethod: field(
        initial.preferences.contactMethod,
      ),
      theme: field(initial.preferences.theme),
      newsletter: field(
        initial.preferences.newsletter,
      ),
    }),

    availability: form({
      startDate: field(
        initial.availability.startDate,
      ),
      hoursPerWeek: field(
        initial.availability.hoursPerWeek,
      ),
      remote: field(initial.availability.remote),
    }),

    skills: list(
      initial.skills.map(createSkill),
    ),
  });
}

export function resetProfile(formState: ProfileForm, value = cloneInitialProfile()): void {
  syncList(formState.fields.skills, value.skills, createSkill);
  formState.reset(value, { updateInitial: true });
}