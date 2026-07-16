import { method } from '@epikodelabs/streamix';

import {
  createIndexedFieldPath,
  parseFormValue,
  readFormPath,
  remapIndexedFieldPaths,
  writeFormPath,
} from './form-helpers';
import {
  getInitialProfileValue,
  calculateCompletion,
  formatProfileJson,
  type ProfileFormValue,
  type SkillValue,
} from './profile-model';
import {
  isUsernamePath,
  validateSnapshot,
  type StreamixErrors,
} from './streamix-form.validation';
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
export {
  getFieldError,
  getFieldHint,
  getPasswordError,
  isReservedUsername,
  isUsernamePath,
  validateUsernameSync,
} from './streamix-form.validation';
import {
  type DraftStatus,
  type PrimitiveValue,
  type TouchedPath,
  type ValueKind,
} from './streamix-form.config';

export interface StreamixUiShape {
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

interface StreamixFormState {
  snapshot(): ProfileFormValue;
  profile: ProfileFormValue['profile'];
  security: ProfileFormValue['security'];
  address: ProfileFormValue['address'];
  preferences: ProfileFormValue['preferences'];
  availability: ProfileFormValue['availability'];
  skills: SkillValue[];
}

interface StreamixUiConfig {
  touchedFields: TouchedPath[];
  usernamePending: boolean;
  usernameTaken: boolean;
  attemptedSubmit: boolean;
  draftStatus: DraftStatus;
  lastSavedAt: string;
  saveRequest: ProfileFormValue | null;
  errors: unknown;
  valid: unknown;
  completion: unknown;
  primarySkills: unknown;
  readyToSubmit: unknown;
  preview: unknown;
  touchField: unknown;
  queueChange: unknown;
  markSaving: unknown;
  markSaved: unknown;
  setAttemptedSubmit: unknown;
  resetAll: unknown;
}

const UI_RESET = {
  touchedFields: [] as TouchedPath[],
  usernamePending: false,
  usernameTaken: false,
  attemptedSubmit: false,
  draftStatus: 'idle' as DraftStatus,
  lastSavedAt: 'Not saved yet',
  saveRequest: null as ProfileFormValue | null,
};

export function cloneInitialProfileValue(): ProfileFormValue {
  return structuredClone(getInitialProfileValue());
}

export function createEmptySkill(): SkillValue {
  return { name: '', years: 1, primary: false };
}

export function createStreamixUiState(
  formState: StreamixFormState,
): StreamixUiConfig {
  return {
    ...UI_RESET,
    errors: (self: any): StreamixErrors =>
      validateSnapshot(formState.snapshot(), self.usernameTaken),
    valid: (self: any) =>
      (self.errors as StreamixErrors).summary.length === 0 && !self.usernamePending,
    completion: () => calculateCompletion(formState.snapshot()),
    primarySkills: () => formatPrimarySkills(formState.snapshot().skills),
    readyToSubmit: (self: any) =>
      self.valid &&
      self.completion >= 85 &&
      formState.snapshot().skills.length > 0,
    preview: () => formatProfileJson(formState.snapshot()),
    touchField: method((self: any, path: TouchedPath) => {
      if (!self.touchedFields.includes(path)) {
        self.touchedFields = [...self.touchedFields, path];
      }
    }),
    queueChange: method((self: any) => {
      self.draftStatus = 'editing';
      self.saveRequest = structuredClone(formState.snapshot());
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
      resetFormState(formState, getInitialProfileValue());
      Object.assign(self, UI_RESET);
    }),
  };
}

export function readPath(source: any, path: string): PrimitiveValue {
  return readFormPath<PrimitiveValue>(source, path);
}

export function writePath(
  source: any,
  path: string,
  value: PrimitiveValue,
): void {
  writeFormPath(source, path, value);
}

export function applyStreamixUpdate(
  formState: StreamixFormState,
  uiState: {
    usernameTaken: boolean;
    usernamePending: boolean;
    queueChange: () => void;
  },
  path: TouchedPath,
  value: PrimitiveValue,
): void {
  writePath(formState, path, value);

  if (isUsernamePath(path)) {
    uiState.usernameTaken = false;
    uiState.usernamePending = false;
  }

  uiState.queueChange();
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
  formState: StreamixFormState,
  touchedFields: TouchedPath[],
  index: number,
): TouchedPath[] {
  if (formState.skills.length === 1) {
    return touchedFields;
  }

  formState.skills = formState.skills.filter(
    (_skill, skillIndex) => skillIndex !== index,
  );

  return remapIndexedFieldPaths(touchedFields, 'skills', index);
}

function resetFormState(
  formState: StreamixFormState,
  value: ProfileFormValue,
): void {
  Object.assign(formState.profile, value.profile);
  Object.assign(formState.security, value.security);
  Object.assign(formState.address, value.address);
  Object.assign(formState.preferences, value.preferences);
  Object.assign(formState.availability, value.availability);
  formState.skills = structuredClone(value.skills);
}

function formatPrimarySkills(skills: SkillValue[]): string {
  return (
    skills
      .filter((skill) => skill.primary)
      .map((skill) => skill.name.trim())
      .filter(Boolean)
      .join(', ') || 'No primary skill selected'
  );
}
