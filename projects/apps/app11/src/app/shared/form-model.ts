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
export {
  calculateCompletion,
  formatProfileJson,
  getInitialProfileValue,
} from './profile-model';
export type {
  ContactMethod,
  ProfileFormValue,
  SkillValue,
  ThemePreference,
} from './profile-model';
import {
  type ContactMethod,
  getInitialProfileValue,
  type ProfileFormValue,
  type SkillValue,
  type ThemePreference,
} from './profile-model';

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
        validators: [Validators.required, Validators.min(10), Validators.max(60)],
      }),
      remote: fb.control(value.availability.remote),
    }),
    skills: fb.array(value.skills.map((skill) => createSkillGroup(fb, skill)), {
      validators: [Validators.minLength(1)],
    }),
  });
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
