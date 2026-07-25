import {
  field,
  form,
  list,
  syncList,
} from "@epikodelabs/streamix/forms";
import {
  getInitialProfileValue,
  type ProfileFormValue,
  type SkillValue,
} from "./profile-model";

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