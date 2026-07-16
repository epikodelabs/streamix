import { AbstractControl } from '@angular/forms';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { map } from 'rxjs';

import {
  calculateCompletion,
  createProfileForm,
  createSkillGroup,
  formatProfileJson,
  getInitialProfileValue,
} from './form-model';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './angular-form.page.html',
  styleUrl: './angular-form.page.scss',
})
export class AngularFormPageComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  readonly form = createProfileForm(this.fb);

  readonly profile = this.form.controls.profile.controls;
  readonly security = this.form.controls.security.controls;
  readonly address = this.form.controls.address.controls;
  readonly preferences = this.form.controls.preferences.controls;
  readonly availability = this.form.controls.availability.controls;

  readonly snapshot = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  readonly status = toSignal(this.form.statusChanges, {
    initialValue: this.form.status,
  });

  readonly attemptedSubmit = signal(false);
  readonly submittedPayload = signal('');

  readonly completion = computed(() => calculateCompletion(this.snapshot()));
  readonly remainingBio = computed(
    () => 240 - this.snapshot().profile.bio.length,
  );
  readonly preview = computed(() => formatProfileJson(this.snapshot()));
  readonly validationSummary = computed(() => {
    this.status();

    const items: string[] = [];

    if (this.form.controls.profile.invalid) {
      items.push('Profile details need cleanup.');
    }
    if (this.form.controls.security.invalid) {
      items.push('Passwords are incomplete or mismatched.');
    }
    if (this.form.controls.address.invalid) {
      items.push('Address information is incomplete.');
    }
    if (this.form.controls.availability.invalid) {
      items.push('Availability is outside the allowed range.');
    }
    if (this.form.controls.skills.invalid) {
      items.push('At least one valid skill entry is required.');
    }

    return items;
  });

  get skills() {
    return this.form.controls.skills.controls;
  }

  addSkill(): void {
    this.form.controls.skills.push(createSkillGroup(this.fb));
  }

  removeSkill(index: number): void {
    if (this.form.controls.skills.length === 1) {
      return;
    }

    this.form.controls.skills.removeAt(index);
  }

  submit(): void {
    this.attemptedSubmit.set(true);
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    this.submittedPayload.set(formatProfileJson(this.form.getRawValue()));
  }

  resetForm(): void {
    const initial = getInitialProfileValue();

    this.form.controls.skills.clear();
    for (const skill of initial.skills) {
      this.form.controls.skills.push(createSkillGroup(this.fb, skill));
    }

    this.form.reset(initial);
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.attemptedSubmit.set(false);
    this.submittedPayload.set('');
  }

  shouldShowError(control: AbstractControl | null): boolean {
    if (!control) {
      return false;
    }

    return control.invalid && (control.touched || control.dirty || this.attemptedSubmit());
  }

  fieldError(control: AbstractControl | null): string | null {
    if (!control || !this.shouldShowError(control) || !control.errors) {
      return null;
    }

    if (control.errors['required']) {
      return 'This field is required.';
    }
    if (control.errors['email']) {
      return 'Use a valid email address.';
    }
    if (control.errors['minlength']) {
      return `Minimum length is ${control.errors['minlength'].requiredLength}.`;
    }
    if (control.errors['maxlength']) {
      return `Maximum length is ${control.errors['maxlength'].requiredLength}.`;
    }
    if (control.errors['pattern']) {
      return 'Format is invalid.';
    }
    if (control.errors['min']) {
      return `Minimum value is ${control.errors['min'].min}.`;
    }
    if (control.errors['max']) {
      return `Maximum value is ${control.errors['max'].max}.`;
    }
    if (control.errors['usernameTaken']) {
      return 'That username is reserved for demos.';
    }

    return 'Please review this field.';
  }

  passwordError(): string | null {
    const group = this.form.controls.security;

    if (!group.errors?.['passwordMismatch']) {
      return null;
    }

    if (!group.touched && !this.attemptedSubmit()) {
      return null;
    }

    return 'Passwords must match.';
  }
}
