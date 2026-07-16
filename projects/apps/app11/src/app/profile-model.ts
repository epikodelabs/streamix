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
