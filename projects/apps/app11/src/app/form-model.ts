import {
  AbstractControl,
  AsyncValidatorFn,
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { map, timer } from 'rxjs';

export type ContactMethod = 'email' | 'phone' | 'slack';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface SkillValue {
  name: string;
  years: number;
  primary: boolean;
}

export interface ProfileFormValue {
  profile: {
    firstName: string;
    lastName: string;
    email: string;
    username: string;
    bio: string;
  };
  security: {
    password: string;
    confirmPassword: string;
  };
  address: {
    country: string;
    city: string;
    postalCode: string;
  };
  preferences: {
    contactMethod: ContactMethod;
    theme: ThemePreference;
    newsletter: boolean;
  };
  availability: {
    startDate: string;
    hoursPerWeek: number;
    remote: boolean;
  };
  skills: SkillValue[];
}

export type SkillFormGroup = FormGroup<{
  name: FormControl<string>;
  years: FormControl<number>;
  primary: FormControl<boolean>;
}>;

export type ProfileFormGroup = FormGroup<{
  profile: FormGroup<{
    firstName: FormControl<string>;
    lastName: FormControl<string>;
    email: FormControl<string>;
    username: FormControl<string>;
    bio: FormControl<string>;
  }>;
  security: FormGroup<{
    password: FormControl<string>;
    confirmPassword: FormControl<string>;
  }>;
  address: FormGroup<{
    country: FormControl<string>;
    city: FormControl<string>;
    postalCode: FormControl<string>;
  }>;
  preferences: FormGroup<{
    contactMethod: FormControl<ContactMethod>;
    theme: FormControl<ThemePreference>;
    newsletter: FormControl<boolean>;
  }>;
  availability: FormGroup<{
    startDate: FormControl<string>;
    hoursPerWeek: FormControl<number>;
    remote: FormControl<boolean>;
  }>;
  skills: FormArray<SkillFormGroup>;
}>;

const RESERVED_USERNAMES = new Set(['admin', 'angular', 'root', 'streamix']);
const POSTAL_CODE_PATTERN = /^[A-Z0-9 -]{4,10}$/i;

export function getInitialProfileValue(): ProfileFormValue {
  return {
    profile: {
      firstName: 'Ava',
      lastName: 'Cole',
      email: 'ava.cole@example.com',
      username: 'ava-c',
      bio: 'Designing an onboarding workflow for a cross-functional product team.',
    },
    security: {
      password: '',
      confirmPassword: '',
    },
    address: {
      country: 'United States',
      city: 'Austin',
      postalCode: '78701',
    },
    preferences: {
      contactMethod: 'email',
      theme: 'system',
      newsletter: true,
    },
    availability: {
      startDate: '2026-08-01',
      hoursPerWeek: 32,
      remote: true,
    },
    skills: [
      {
        name: 'Angular',
        years: 4,
        primary: true,
      },
    ],
  };
}

export function createSkillGroup(
  fb: NonNullableFormBuilder,
  value: SkillValue = { name: '', years: 1, primary: false },
): SkillFormGroup {
  return fb.group({
    name: fb.control(value.name, {
      validators: [Validators.required, Validators.minLength(2)],
    }),
    years: fb.control(value.years, {
      validators: [Validators.min(1), Validators.max(20)],
    }),
    primary: fb.control(value.primary),
  });
}

export function createProfileForm(
  fb: NonNullableFormBuilder,
  value: ProfileFormValue = getInitialProfileValue(),
): ProfileFormGroup {
  return fb.group({
    profile: fb.group({
      firstName: fb.control(value.profile.firstName, {
        validators: [Validators.required, Validators.minLength(2)],
      }),
      lastName: fb.control(value.profile.lastName, {
        validators: [Validators.required, Validators.minLength(2)],
      }),
      email: fb.control(value.profile.email, {
        validators: [Validators.required, Validators.email],
      }),
      username: fb.control(value.profile.username, {
        validators: [
          Validators.required,
          Validators.minLength(3),
          Validators.pattern(/^[a-z0-9-]+$/),
        ],
        asyncValidators: [usernameTakenValidator()],
        updateOn: 'blur',
      }),
      bio: fb.control(value.profile.bio, {
        validators: [Validators.required, Validators.maxLength(240)],
      }),
    }),
    security: fb.group(
      {
        password: fb.control(value.security.password, {
          validators: [Validators.required, Validators.minLength(8)],
        }),
        confirmPassword: fb.control(value.security.confirmPassword, {
          validators: [Validators.required],
        }),
      },
      { validators: passwordMatchValidator },
    ),
    address: fb.group({
      country: fb.control(value.address.country, {
        validators: [Validators.required],
      }),
      city: fb.control(value.address.city, {
        validators: [Validators.required],
      }),
      postalCode: fb.control(value.address.postalCode, {
        validators: [Validators.required, Validators.pattern(POSTAL_CODE_PATTERN)],
      }),
    }),
    preferences: fb.group({
      contactMethod: fb.control(value.preferences.contactMethod),
      theme: fb.control(value.preferences.theme),
      newsletter: fb.control(value.preferences.newsletter),
    }),
    availability: fb.group({
      startDate: fb.control(value.availability.startDate, {
        validators: [Validators.required],
      }),
      hoursPerWeek: fb.control(value.availability.hoursPerWeek, {
        validators: [Validators.min(10), Validators.max(60)],
      }),
      remote: fb.control(value.availability.remote),
    }),
    skills: fb.array(value.skills.map((skill) => createSkillGroup(fb, skill)), {
      validators: [Validators.minLength(1)],
    }),
  });
}

export function calculateCompletion(value: ProfileFormValue): number {
  const checks = [
    value.profile.firstName.trim().length > 0,
    value.profile.lastName.trim().length > 0,
    value.profile.email.trim().length > 0,
    value.profile.username.trim().length > 0,
    value.profile.bio.trim().length > 0,
    value.security.password.trim().length > 0,
    value.security.confirmPassword.trim().length > 0,
    value.address.country.trim().length > 0,
    value.address.city.trim().length > 0,
    value.address.postalCode.trim().length > 0,
    value.preferences.contactMethod.trim().length > 0,
    value.availability.startDate.trim().length > 0,
    value.skills.some((skill) => skill.name.trim().length > 0),
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function formatProfileJson(value: ProfileFormValue): string {
  return JSON.stringify(value, null, 2);
}

export function passwordMatchValidator(
  control: AbstractControl,
): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirmPassword = control.get('confirmPassword')?.value;

  if (!password || !confirmPassword) {
    return null;
  }

  return password === confirmPassword ? null : { passwordMismatch: true };
}

function usernameTakenValidator(): AsyncValidatorFn {
  return (control: AbstractControl) => {
    const value = String(control.value ?? '').trim().toLowerCase();

    if (!value) {
      return timer(0).pipe(map(() => null));
    }

    return timer(300).pipe(
      map(() => (RESERVED_USERNAMES.has(value) ? { usernameTaken: true } : null)),
    );
  };
}
