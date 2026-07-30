import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { atom, derived } from '@epikodelabs/streamix';
import { StreamixFormBindingDirective, fieldError, fieldHint, resolveField } from '@epikodelabs/streamix/forms';
import {
  cloneInitialProfile,
  contactOptions,
  createProfileForm,
  createSkill,
  resetProfile,
  themeOptions,
} from '../../shared/profile-form';
import { calculateCompletion, formatProfileJson, type ProfileFormValue } from '../../shared/profile-model';

@Component({
  standalone: true,
  imports: [CommonModule, StreamixFormBindingDirective],
  templateUrl: './streamix-form.page.html',
  styleUrl: './streamix-form.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StreamixFormPageComponent implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);

  readonly form = createProfileForm();
  readonly skills = this.form.fields.skills;
  readonly contactOptions = contactOptions;
  readonly themeOptions = themeOptions;
  private readonly submittedPayload = atom('');
  readonly uiState = derived(($) => {
    const snapshot = $(this.form.state).completeValue as ProfileFormValue;
    const payload = $(this.submittedPayload);
    return this.createUiState({
      snapshot,
      submittedPayload: payload,
      securityTouched: $(this.form.fields.security.touched),
      securityIssues: $(this.form.fields.security.issues),
      profileInvalid: $(this.form.fields.profile.invalid),
      securityInvalid: $(this.form.fields.security.invalid),
      addressInvalid: $(this.form.fields.address.invalid),
      availabilityInvalid: $(this.form.fields.availability.invalid),
      skillsInvalid: $(this.form.fields.skills.invalid),
    });
  });
  private readonly stopUiState = this.uiState.subscribe(() => this.cdr.detectChanges());

  submit(event: Event): void {
    event.preventDefault();
    this.form.touch();
    if (this.form.invalid.value) {
      this.cdr.detectChanges();
      return;
    }
    this.submittedPayload.set(this.uiState.value.preview);
  }

  reset(): void {
    this.submittedPayload.set('');
    resetProfile(this.form, cloneInitialProfile());
  }

  addSkill(): void {
    this.skills.push(createSkill());
  }

  removeSkill(index: number): void {
    if (this.skills.items.length > 1) this.skills.removeAt(index);
  }

  ngOnDestroy(): void {
    this.stopUiState();
    this.uiState.dispose();
    this.submittedPayload.dispose();
    this.form.dispose();
  }

  // These are used in the template
  fieldError(path: string, pendingHint?: string): string | null {
    const node = resolveField(this.form, path);
    return node ? fieldError({ node, label: '', pendingHint }) : null;
  }

  fieldHint(path: string, pendingHint?: string): string | null {
    const node = resolveField(this.form, path);
    return node ? fieldHint({ node, label: '', pendingHint }) : null;
  }

  private createUiState({
    snapshot,
    submittedPayload,
    securityTouched,
    securityIssues,
    profileInvalid,
    securityInvalid,
    addressInvalid,
    availabilityInvalid,
    skillsInvalid,
  }: {
    snapshot: ProfileFormValue;
    submittedPayload: string;
    securityTouched: boolean;
    securityIssues: any;
    profileInvalid: boolean;
    securityInvalid: boolean;
    addressInvalid: boolean;
    availabilityInvalid: boolean;
    skillsInvalid: boolean;
  }) {
    const passwordError = securityTouched ? this.passwordError(securityIssues) : null;

    return {
      completion: calculateCompletion(snapshot),
      contactMethod: snapshot.preferences.contactMethod,
      hoursPerWeek: snapshot.availability.hoursPerWeek,
      passwordError,
      preview: formatProfileJson(snapshot),
      remainingBio: 240 - snapshot.profile.bio.length,
      remote: snapshot.availability.remote,
      submittedPayload,
      validationSummary: this.validationSummary({
        profileInvalid,
        securityInvalid,
        addressInvalid,
        availabilityInvalid,
        skillsInvalid,
      }),
    };
  }

  private passwordError(issues: any): string | null {
    const formIssues = issues?.['$form'];
    return formIssues && typeof formIssues === 'object' && 'passwordMismatch' in formIssues
      ? 'Passwords are incomplete or mismatched.'
      : null;
  }

  private validationSummary({
    profileInvalid,
    securityInvalid,
    addressInvalid,
    availabilityInvalid,
    skillsInvalid,
  }: {
    profileInvalid: boolean;
    securityInvalid: boolean;
    addressInvalid: boolean;
    availabilityInvalid: boolean;
    skillsInvalid: boolean;
  }): readonly string[] {
    const items: string[] = [];
    if (profileInvalid) items.push('Profile details need cleanup.');
    if (securityInvalid) items.push('Passwords are incomplete or mismatched.');
    if (addressInvalid) items.push('Address information is incomplete.');
    if (availabilityInvalid) items.push('Availability is outside the allowed range.');
    if (skillsInvalid) items.push('At least one valid skill entry is required.');
    return items;
  }
}
