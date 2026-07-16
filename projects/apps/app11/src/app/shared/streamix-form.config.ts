import {
  type ContactMethod,
  type SkillValue,
  type ThemePreference,
} from './profile-model';
import {
  type FieldPath,
  type FieldValueKind,
  type FormValuePrimitive,
} from './form-helpers';

export type DraftStatus = 'idle' | 'editing' | 'saving' | 'saved';
export type TouchedPath = FieldPath;
export type ValueKind = FieldValueKind;
export type PrimitiveValue = FormValuePrimitive;
export type FieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'date'
  | 'textarea'
  | 'number'
  | 'range';

export interface FieldConfig {
  path: TouchedPath;
  label: string;
  type: FieldType;
  kind?: ValueKind;
  rows?: number;
  min?: number;
  max?: number;
}

export interface SkillFieldConfig extends Omit<FieldConfig, 'path'> {
  key: Extract<keyof SkillValue, 'name' | 'years'>;
  compact?: boolean;
}

export interface OptionConfig<T extends string> {
  label: string;
  value: T;
}

export const profileFields: FieldConfig[] = [
  { path: 'profile.firstName', label: 'First name', type: 'text' },
  { path: 'profile.lastName', label: 'Last name', type: 'text' },
  { path: 'profile.email', label: 'Email', type: 'email' },
  { path: 'profile.username', label: 'Username', type: 'text' },
  { path: 'profile.bio', label: 'Bio', type: 'textarea', rows: 4 },
];

export const securityFields: FieldConfig[] = [
  { path: 'security.password', label: 'Password', type: 'password' },
  { path: 'security.confirmPassword', label: 'Confirm password', type: 'password' },
];

export const addressFields: FieldConfig[] = [
  { path: 'address.country', label: 'Country', type: 'text' },
  { path: 'address.city', label: 'City', type: 'text' },
  { path: 'address.postalCode', label: 'Postal code', type: 'text' },
];

export const availabilityFields: FieldConfig[] = [
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

export const skillFields: SkillFieldConfig[] = [
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

export const contactOptions: OptionConfig<ContactMethod>[] = [
  { label: 'Email', value: 'email' },
  { label: 'Phone', value: 'phone' },
  { label: 'Slack', value: 'slack' },
];

export const themeOptions: OptionConfig<ThemePreference>[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];
