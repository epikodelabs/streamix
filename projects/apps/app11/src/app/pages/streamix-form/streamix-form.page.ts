import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { atom, type Subscription } from '@epikodelabs/streamix';

import {
  calculateCompletion,
  formatProfileJson,
  type ProfileFormValue,
  type SkillValue,
} from '../../shared/profile-model';
import {
  addressFields,
  applyStreamixUpdate,
  availabilityFields,
  cloneInitialProfileValue,
  contactOptions,
  createEmptySkill,
  createProfileStreamixForm,
  createSkillFormNode,
  getFieldError,
  getFieldHint,
  getNodeError,
  getPasswordError,
  getPrimarySkills,
  getSummary,
  isFormValid,
  parseEventValue,
  profileFields,
  readPath,
  removeSkill,
  resetProfileForm,
  securityFields,
  skillFields,
  touchPath,
  themeOptions,
  type DraftStatus,
  type PrimitiveValue,
  type SkillFormNode,
  type TouchedPath,
  type ValueKind,
} from '../../shared/streamix-form.helpers';

@Component({
  standalone: true,
  templateUrl: './streamix-form.page.html',
  styleUrl: './streamix-form.page.scss',
})
export class StreamixFormPageComponent implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly formState = createProfileStreamixForm(cloneInitialProfileValue());
  private readonly attemptedSubmitState = atom(false);
  private readonly draftStatusState = atom<DraftStatus>('idle');
  private readonly lastSavedAtState = atom('Not saved yet');
  private readonly submittedPayloadState = atom('');
  private readonly subscriptions: Subscription[] = [
    this.formState.completeValue.subscribe(() => this.syncView()),
    this.formState.issues.subscribe(() => this.syncView()),
    this.formState.pending.subscribe(() => this.syncView()),
    this.formState.status.subscribe(() => this.syncView()),
    this.attemptedSubmitState.subscribe(() => this.syncView()),
    this.draftStatusState.subscribe(() => this.syncView()),
    this.lastSavedAtState.subscribe(() => this.syncView()),
    this.submittedPayloadState.subscribe(() => this.syncView()),
  ];

  private autosaveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private autosaveCommitTimer: ReturnType<typeof setTimeout> | null = null;
  private autosaveToken = 0;

  readonly profileFields = profileFields;
  readonly securityFields = securityFields;
  readonly addressFields = addressFields;
  readonly availabilityFields = availabilityFields;
  readonly skillFields = skillFields;
  readonly contactOptions = contactOptions;
  readonly themeOptions = themeOptions;

  get skills(): readonly SkillFormNode[] {
    return this.formState.fields.skills.items;
  }

  get submittedPayload(): string {
    return this.submittedPayloadState.value;
  }

  get uiState(): {
      attemptedSubmit: boolean;
      draftStatus: DraftStatus;
      lastSavedAt: string;
    errors: { summary: string[] };
    valid: boolean;
    completion: number;
    primarySkills: string;
    readyToSubmit: boolean;
    preview: string;
  } {
    const valid = isFormValid(this.formState);
    const completion = calculateCompletion(this.snapshot);

    return {
      attemptedSubmit: this.attemptedSubmitState.value,
      draftStatus: this.draftStatusState.value,
      lastSavedAt: this.lastSavedAtState.value,
      errors: getSummary(this.formState),
      valid,
      completion,
      primarySkills: getPrimarySkills(this.formState),
      readyToSubmit: valid && completion >= 85 && this.skills.length > 0,
      preview: formatProfileJson(this.snapshot),
    };
  }

  private get snapshot(): ProfileFormValue {
    return this.formState.completeValue.value;
  }

  ngOnDestroy(): void {
    this.clearAutosaveTimer();
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.formState.dispose();
  }

  touchField(path: TouchedPath): void {
    touchPath(this.formState, path);
    this.syncView();
  }

  addSkill(): void {
    this.formState.fields.skills.push(createSkillFormNode(createEmptySkill()));
    this.queueAutosave();
    this.syncView();
  }

  removeSkill(index: number): void {
    if (this.skills.length === 1) {
      return;
    }

    removeSkill(this.formState, index);
    this.queueAutosave();
    this.syncView();
  }

  submit(event: Event): void {
    event.preventDefault();
    this.attemptedSubmitState.set(true);

    if (!isFormValid(this.formState)) {
      this.syncView();
      return;
    }

    this.submittedPayloadState.set(
      formatProfileJson(structuredClone(this.snapshot)),
    );
    this.draftStatusState.set('saved');
    this.syncView();
  }

  resetForm(): void {
    resetProfileForm(this.formState, cloneInitialProfileValue());
    this.attemptedSubmitState.set(false);
    this.draftStatusState.set('idle');
    this.lastSavedAtState.set('Not saved yet');
    this.submittedPayloadState.set('');
    this.clearAutosaveTimer();
    this.syncView();
  }

  fieldError(path: TouchedPath): string | null {
    return getFieldError(this.formState, path, this.attemptedSubmitState.value);
  }

  read(path: TouchedPath): PrimitiveValue {
    return readPath(this.formState, path);
  }

  update(path: TouchedPath, value: PrimitiveValue): void {
    applyStreamixUpdate(this.formState, path, value);
    this.queueAutosave();
    this.syncView();
  }

  updateFromEvent(
    path: TouchedPath,
    event: Event,
    kind: ValueKind = 'text',
  ): void {
    this.update(path, parseEventValue(event, kind));
  }

  readSkillField(
    skill: SkillFormNode,
    key: keyof SkillValue,
  ): PrimitiveValue {
    return skill.fields[key].completeValue.value as PrimitiveValue;
  }

  touchSkillField(
    skill: SkillFormNode,
    key: keyof SkillValue,
  ): void {
    skill.fields[key].touch();
    this.syncView();
  }

  updateSkillField(
    skill: SkillFormNode,
    key: keyof SkillValue,
    value: PrimitiveValue,
  ): void {
    skill.fields[key].set(value as never);
    this.queueAutosave();
    this.syncView();
  }

  updateSkillFromEvent(
    skill: SkillFormNode,
    key: keyof SkillValue,
    event: Event,
    kind: ValueKind = 'text',
  ): void {
    this.updateSkillField(skill, key, parseEventValue(event, kind));
  }

  skillFieldError(
    skill: SkillFormNode,
    key: Extract<keyof SkillValue, 'name' | 'years'>,
  ): string | null {
    return getNodeError(skill.fields[key], this.attemptedSubmitState.value);
  }

  fieldHint(path: TouchedPath): string | null {
    return getFieldHint(this.formState, path);
  }

  passwordError(): string | null {
    return getPasswordError(this.formState, this.attemptedSubmitState.value);
  }

  private queueAutosave(): void {
    const token = ++this.autosaveToken;

    this.draftStatusState.set('editing');
    this.clearAutosaveTimer();

    this.autosaveDebounceTimer = setTimeout(() => {
      if (token !== this.autosaveToken) {
        return;
      }

      this.draftStatusState.set('saving');
      this.syncView();

      this.autosaveCommitTimer = setTimeout(() => {
        if (token !== this.autosaveToken) {
          return;
        }

        this.lastSavedAtState.set(new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }));
        this.draftStatusState.set('saved');
        this.syncView();
      }, 260);
    }, 650);
  }

  private clearAutosaveTimer(): void {
    if (this.autosaveDebounceTimer) {
      clearTimeout(this.autosaveDebounceTimer);
      this.autosaveDebounceTimer = null;
    }
    if (this.autosaveCommitTimer) {
      clearTimeout(this.autosaveCommitTimer);
      this.autosaveCommitTimer = null;
    }
  }

  private syncView(): void {
    this.cdr.detectChanges();
  }
}
