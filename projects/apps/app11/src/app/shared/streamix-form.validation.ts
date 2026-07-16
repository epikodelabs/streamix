import {
  type ProfileFormValue,
} from './profile-model';
import {
  shouldShowFieldError,
} from './form-helpers';
import {
  type PrimitiveValue,
  type TouchedPath,
} from './streamix-form.config';

export interface StreamixErrors {
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

const RESERVED_USERNAMES = new Set(['admin', 'angular', 'root', 'streamix']);
const POSTAL_CODE_PATTERN = /^[A-Z0-9 -]{4,10}$/i;

export function validateSnapshot(
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
      confirmPassword: required(snapshot.security.confirmPassword),
      group: null,
    },
    address: {
      country: required(snapshot.address.country),
      city: required(snapshot.address.city),
      postalCode: validatePostalCode(snapshot.address.postalCode),
    },
    availability: {
      startDate: required(snapshot.availability.startDate),
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

  pushSummary(
    errors.summary,
    [
      errors.profile.firstName,
      errors.profile.lastName,
      errors.profile.email,
      errors.profile.username,
      errors.profile.bio,
    ],
    'Profile details need cleanup.',
  );
  pushSummary(
    errors.summary,
    [
      errors.security.password,
      errors.security.confirmPassword,
      errors.security.group,
    ],
    'Passwords are incomplete or mismatched.',
  );
  pushSummary(
    errors.summary,
    [
      errors.address.country,
      errors.address.city,
      errors.address.postalCode,
    ],
    'Address information is incomplete.',
  );
  pushSummary(
    errors.summary,
    [errors.availability.startDate, errors.availability.hoursPerWeek],
    'Availability is outside the allowed range.',
  );
  pushSummary(
    errors.summary,
    errors.skills.some((skill) => skill.name || skill.years),
    'At least one valid skill entry is required.',
  );

  return errors;
}

export function validateUsernameSync(value: string): string | null {
  const normalized = value.trim();

  if (!normalized) {
    return 'This field is required.';
  }
  if (normalized.length < 3) {
    return 'Minimum length is 3.';
  }
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return 'Format is invalid.';
  }

  return null;
}

export function isReservedUsername(value: string): boolean {
  return RESERVED_USERNAMES.has(value.trim().toLowerCase());
}

export function isUsernamePath(path: TouchedPath): boolean {
  return path === 'profile.username';
}

export function getFieldHint(
  path: TouchedPath,
  usernamePending: boolean,
  value: PrimitiveValue,
): string | null {
  if (isUsernamePath(path) && usernamePending) {
    return 'Checking username availability...';
  }

  return path === 'availability.hoursPerWeek' ? `${value} hrs/week` : null;
}

export function getFieldError(
  errors: StreamixErrors,
  path: TouchedPath,
  attemptedSubmit: boolean,
  touchedFields: TouchedPath[],
  usernamePending: boolean,
): string | null {
  if (
    isUsernamePath(path) && usernamePending ||
    !shouldShowFieldError(path, touchedFields, attemptedSubmit)
  ) {
    return null;
  }

  return readErrorAtPath(errors, path);
}

export function getPasswordError(uiState: {
  attemptedSubmit: boolean;
  touchedFields: TouchedPath[];
  errors: StreamixErrors;
}): string | null {
  return (
    uiState.attemptedSubmit ||
    uiState.touchedFields.includes('security.password') ||
    uiState.touchedFields.includes('security.confirmPassword')
  )
    ? uiState.errors.security.group
    : null;
}

function required(value: string): string | null {
  return value.trim().length === 0 ? 'This field is required.' : null;
}

function textRequired(value: string, minLength = 1): string | null {
  const empty = required(value);

  if (empty) {
    return empty;
  }
  if (value.trim().length < minLength) {
    return `Minimum length is ${minLength}.`;
  }

  return null;
}

function validateEmail(value: string): string | null {
  const empty = required(value);

  if (empty) {
    return empty;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    return 'Use a valid email address.';
  }

  return null;
}

function validateBio(value: string): string | null {
  const empty = required(value);

  if (empty) {
    return empty;
  }
  if (value.length > 240) {
    return 'Maximum length is 240.';
  }

  return null;
}

function validatePassword(value: string): string | null {
  const empty = required(value);

  if (empty) {
    return empty;
  }
  if (value.length < 8) {
    return 'Minimum length is 8.';
  }

  return null;
}

function validatePostalCode(value: string): string | null {
  const empty = required(value);

  if (empty) {
    return empty;
  }
  if (!POSTAL_CODE_PATTERN.test(value.trim())) {
    return 'Format is invalid.';
  }

  return null;
}

function validateHours(value: number): string | null {
  return rangeError(value, 10, 60);
}

function validateSkillYears(value: number): string | null {
  return rangeError(value, 1, 20);
}

function rangeError(
  value: number,
  min: number,
  max: number,
): string | null {
  if (value < min) {
    return `Minimum value is ${min}.`;
  }
  if (value > max) {
    return `Maximum value is ${max}.`;
  }

  return null;
}

function pushSummary(
  summary: string[],
  invalid: unknown[] | boolean,
  message: string,
): void {
  if (Array.isArray(invalid) ? invalid.some(Boolean) : invalid) {
    summary.push(message);
  }
}

function readErrorAtPath(errors: StreamixErrors, path: string): string | null {
  const [group, keyOrIndex, nestedKey] = path.split('.');

  if (group === 'skills') {
    const index = Number(keyOrIndex);
    const key = nestedKey as keyof StreamixErrors['skills'][number];
    return errors.skills[index]?.[key] ?? null;
  }

  return (
    errors[group as keyof Omit<StreamixErrors, 'skills' | 'summary'>] as Record<
      string,
      string | null
    >
  )[keyOrIndex] ?? null;
}
