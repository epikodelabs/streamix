import { atom } from '@epikodelabs/streamix';
import { bindField, field, form, list, syncList } from '@epikodelabs/streamix/forms';

describe('Forms', () => {
  it('converts or suppresses asynchronous validation failures explicitly', async () => {
    const converted = field('Ada', {
      validateInitial: false,
      asyncChecks: () => Promise.reject(new Error('offline')),
      asyncFailureToIssues: () => ({ unavailable: true }),
    });
    const suppressed = field('Grace', {
      validateInitial: false,
      asyncChecks: () => Promise.reject(new Error('offline')),
      asyncFailureToIssues: () => null,
    });
    const preserved = field('Marie', {
      validateInitial: false,
      asyncChecks: () => Promise.reject(new Error('offline')),
    });

    converted.set('Lin');
    suppressed.set('Marie');
    preserved.set('Ada');
    await new Promise<void>(resolve => setTimeout(resolve));

    expect(converted.validationError.value).toBeNull();
    expect(converted.issues.value).toEqual({ unavailable: true });
    expect(converted.status.value).toBe('invalid');
    expect(converted.invalid.value).toBeTrue();

    expect(suppressed.validationError.value).toBeNull();
    expect(suppressed.issues.value).toBeNull();
    expect(suppressed.status.value).toBe('valid');

    expect(preserved.validationError.value).toEqual(jasmine.any(Error));
    expect(preserved.issues.value).toBeNull();
    expect(preserved.status.value).toBe('error');

    converted.dispose();
    suppressed.dispose();
    preserved.dispose();
  });

  it('prioritizes pending validation over synchronous issues', async () => {
    let resolve!: (value: null) => void;
    const name = field('', {
      validateInitial: false,
      checks: value => value === '' ? { required: true } : null,
      asyncChecks: () => new Promise<null>(next => {
        resolve = next;
      }),
      asyncOnlyWhenSyncClean: false,
    });

    name.set('');

    expect(name.issues.value).toEqual({ required: true });
    expect(name.pending.value).toBeTrue();
    expect(name.status.value).toBe('pending');
    expect(name.invalid.value).toBeFalse();

    resolve(null);
    await new Promise<void>(next => setTimeout(next));

    expect(name.pending.value).toBeFalse();
    expect(name.status.value).toBe('invalid');
    expect(name.invalid.value).toBeTrue();
    name.dispose();
  });

  it('keeps pending true while a debounced async validation is replaced', async () => {
    const resolvers: Array<(value: null) => void> = [];
    const name = field('', {
      validateInitial: false,
      asyncDelay: 5,
      asyncChecks: () => new Promise<null>(resolve => {
        resolvers.push(resolve);
      }),
    });
    const pendingValues: boolean[] = [];
    const unsubscribe = name.pending.subscribe(value => {
      pendingValues.push(value);
    });

    name.set('first');
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    expect(name.pending.value).toBeTrue();

    name.set('second');
    expect(name.pending.value).toBeTrue();
    expect(pendingValues).toEqual([true]);

    await new Promise<void>(resolve => setTimeout(resolve, 10));
    resolvers[1](null);
    await new Promise<void>(resolve => setTimeout(resolve));

    expect(pendingValues).toEqual([true, false]);
    unsubscribe();
    name.dispose();
  });

  it('applies and removes field validation sources at runtime', async () => {
    const name = field('', { validateInitial: false });
    const syncSource = {};
    const asyncSource = {};

    name.useValidation(syncSource, {
      checks: value => value === '' ? { required: true } : null,
    });

    expect(name.issues.value).toEqual({ required: true });
    expect(name.invalid.value).toBeTrue();

    name.set('Ada');
    expect(name.issues.value).toBeNull();

    name.useValidation(asyncSource, {
      asyncChecks: async value => value === 'taken' ? { usernameTaken: true } : null,
    });

    name.set('taken');
    await new Promise<void>(resolve => setTimeout(resolve));
    expect(name.issues.value).toEqual({ usernameTaken: true });

    name.clearValidation(asyncSource);
    await new Promise<void>(resolve => setTimeout(resolve));
    expect(name.issues.value).toBeNull();

    name.clearValidation(syncSource);
    name.set('');
    expect(name.issues.value).toBeNull();
    expect(name.invalid.value).toBeFalse();

    name.dispose();
  });

  it('applies and removes form-level validation sources at runtime', () => {
    const password = field('secret');
    const confirmPassword = field('mismatch');
    const security = form(
      { password, confirmPassword },
      { ownsChildren: false },
    );
    const source = {};

    security.useChecks(source, value =>
      value.password === value.confirmPassword
        ? null
        : { passwordMismatch: true },
    );

    expect(security.invalid.value).toBeTrue();
    expect(security.issues.value?.['$form']).toEqual({
      passwordMismatch: true,
    });

    confirmPassword.set('secret');
    expect(security.invalid.value).toBeFalse();

    security.useChecks(source, value =>
      value.password.length >= 8
        ? null
        : { passwordTooShort: true },
    );
    expect(security.invalid.value).toBeTrue();

    security.clearChecks(source);
    expect(security.issues.value).toBeNull();
    expect(security.invalid.value).toBeFalse();

    security.dispose();
    password.dispose();
    confirmPassword.dispose();
  });

  it('enables containers without emitting an intermediate partial value', () => {
    const name = field('Ada');
    const profile = form({ name }, { ownsChildren: false });
    profile.disable();
    const formValues: unknown[] = [];
    const unsubscribeForm = profile.value.subscribe(value => {
      formValues.push(value);
    });

    profile.enable();

    expect(formValues).toEqual([{ name: 'Ada' }]);

    const skill = field('TypeScript');
    const skills = list([skill], { ownsChildren: false });
    skills.disable();
    const listValues: unknown[] = [];
    const unsubscribeList = skills.value.subscribe(value => {
      listValues.push(value);
    });

    skills.enable();

    expect(listValues).toEqual([['TypeScript']]);

    unsubscribeForm();
    unsubscribeList();
    profile.dispose();
    name.dispose();
    skills.dispose();
    skill.dispose();
  });

  it('ignores missing keys in full form writes and resets them independently', () => {
    const name = field('Ada');
    const age = field(1);
    const profile = form({ name, age }, { ownsChildren: false });

    profile.set({ name: 'Grace' } as any);
    expect(name.value.value).toBe('Grace');
    expect(age.value.value).toBe(1);

    age.set(2);
    profile.reset({ name: 'Lin' } as any);
    expect(name.value.value).toBe('Lin');
    expect(age.value.value).toBe(1);

    profile.dispose();
    name.dispose();
    age.dispose();
  });

  it('releases containment claims when aggregate initialization throws', () => {
    const name = field('Ada');
    const completeValue = name.completeValue;
    let throwOnRead = true;

    Object.defineProperty(name, 'completeValue', {
      get: () => {
        if (throwOnRead) {
          throwOnRead = false;
          throw new Error('read failure');
        }

        return completeValue;
      },
    });

    expect(() => form({ name }, { ownsChildren: false })).toThrowError(
      'read failure',
    );

    throwOnRead = true;
    expect(() => list([name], { ownsChildren: false })).toThrowError(
      'read failure',
    );

    const profile = form({ name }, { ownsChildren: false });
    profile.dispose();
    name.dispose();
  });

  it('cleans partial child subscriptions when form setup fails', () => {
    const first = field('Ada');
    const second = field('Grace');
    let firstUnsubscribed = false;
    const firstSubscribe = spyOn(first.state, 'subscribe').and.callFake(() =>
      (() => {
        firstUnsubscribed = true;
      }) as any,
    );
    const secondSubscribe = spyOn(second.state, 'subscribe').and.throwError(
      'subscribe failure',
    );

    expect(() => form({ first, second }, { ownsChildren: false })).toThrowError(
      'subscribe failure',
    );
    expect(firstUnsubscribed).toBeTrue();

    firstSubscribe.and.callThrough();
    secondSubscribe.and.callThrough();

    const profile = form({ first, second }, { ownsChildren: false });
    profile.dispose();
    first.dispose();
    second.dispose();
  });

  it('synchronizes a bound field with its caller-owned source', () => {
    const source = atom('Ada', { discrete: true });
    const name = bindField(source);

    name.set('Grace');
    expect(source.value).toBe('Grace');
    expect(name.value.value).toBe('Grace');

    source.set('Lin');
    expect(name.value.value).toBe('Lin');
    expect(name.dirty.value).toBeTrue();

    name.reset('Ada', { updateInitial: true });
    expect(source.value).toBe('Ada');
    expect(name.dirty.value).toBeFalse();

    name.dispose();
    expect(source.disposed).toBeFalse();

    source.set('Marie');
    expect(source.value).toBe('Marie');
    source.dispose();
  });

  it('keeps aggregate value projections stable for non-value changes', () => {
    const name = field('Ada');
    const profile = form({ name }, { ownsChildren: false });
    const profileValue = profile.value.value;
    const profileCompleteValue = profile.completeValue.value;
    let profileValueUpdates = 0;
    let profileCompleteValueUpdates = 0;
    const unsubscribeProfileValue = profile.value.subscribe(() => {
      profileValueUpdates++;
    });
    const unsubscribeProfileCompleteValue = profile.completeValue.subscribe(
      () => {
        profileCompleteValueUpdates++;
      },
    );

    name.touch();

    expect(profile.value.value).toBe(profileValue);
    expect(profile.completeValue.value).toBe(profileCompleteValue);
    expect(profileValueUpdates).toBe(0);
    expect(profileCompleteValueUpdates).toBe(0);

    const skill = field('TypeScript');
    const skills = list([skill], { ownsChildren: false });
    const listValue = skills.value.value;
    const listCompleteValue = skills.completeValue.value;
    let listValueUpdates = 0;
    const unsubscribeListValue = skills.value.subscribe(() => {
      listValueUpdates++;
    });

    skill.touch();

    expect(skills.value.value).toBe(listValue);
    expect(skills.completeValue.value).toBe(listCompleteValue);
    expect(listValueUpdates).toBe(0);

    const required = field('', {
      checks: current => current === '' ? { required: true } : null,
    });
    const requiredIssues = required.issues.value;
    let requiredIssueUpdates = 0;
    const unsubscribeRequiredIssues = required.issues.subscribe(() => {
      requiredIssueUpdates++;
    });

    required.touch();
    required.set('');

    expect(required.issues.value).toBe(requiredIssues);
    expect(requiredIssueUpdates).toBe(0);

    unsubscribeProfileValue();
    unsubscribeProfileCompleteValue();
    unsubscribeListValue();
    unsubscribeRequiredIssues();
    profile.dispose();
    name.dispose();
    skills.dispose();
    skill.dispose();
    required.dispose();
  });

  it('enforces exclusive container membership and releases detached nodes', () => {
    const name = field('Ada');
    const first = form({ name }, { ownsChildren: false });

    expect(() => form({ name }, { ownsChildren: false })).toThrowError(
      'A form node cannot belong to more than one form container.',
    );

    first.dispose();

    const skills = list([name], { ownsChildren: false });
    expect(skills.detachAt(0)).toBe(name);

    let second!: ReturnType<typeof form>;
    expect(() => {
      second = form({ name }, { ownsChildren: false });
    }).not.toThrow();

    skills.dispose();
    second.dispose();
    name.dispose();
  });

  it('tracks touch state on empty containers and protects form keys', () => {
    const emptyForm = form({});
    const emptyList = list([]);

    emptyForm.touch();
    emptyList.touch();
    expect(emptyForm.touched.value).toBeTrue();
    expect(emptyList.touched.value).toBeTrue();

    emptyForm.reset();
    emptyList.reset();
    expect(emptyForm.touched.value).toBeFalse();
    expect(emptyList.touched.value).toBeFalse();

    const name = field('Ada');
    const profile = form({ name }, { ownsChildren: false });
    expect(() => profile.patch({ constructor: 'ignored' } as any)).not.toThrow();
    expect(name.value.value).toBe('Ada');

    const reserved = field('reserved');
    expect(() => form({ $form: reserved } as any)).toThrowError(
      '"$form" is reserved for form-level validation issues.',
    );

    emptyForm.dispose();
    emptyList.dispose();
    profile.dispose();
    name.dispose();
    reserved.dispose();
  });

  it('cascades disabled state without re-enabling independently disabled fields', () => {
    const editable = field('editable');
    const independentlyDisabled = field('locked', { disabled: true });
    const profile = form(
      { editable, independentlyDisabled },
      { ownsChildren: false },
    );

    profile.disable();

    expect(profile.disabled.value).toBeTrue();
    expect(editable.disabled.value).toBeTrue();
    expect(independentlyDisabled.disabled.value).toBeTrue();

    profile.enable();

    expect(profile.disabled.value).toBeFalse();
    expect(editable.disabled.value).toBeFalse();
    expect(independentlyDisabled.disabled.value).toBeTrue();

    profile.dispose();
    editable.dispose();
    independentlyDisabled.dispose();
  });

  it('supports aggregate-only disabling with onlySelf', () => {
    const name = field('Ada');
    const profile = form({ name }, { ownsChildren: false });

    profile.disable({ onlySelf: true });

    expect(profile.disabled.value).toBeTrue();
    expect(name.disabled.value).toBeFalse();

    profile.enable({ onlySelf: true });
    profile.dispose();
    name.dispose();
  });

  it('restores a parent-disabled item when it is detached from a non-owning list', () => {
    const skill = field('TypeScript');
    const skills = list<typeof skill>([], { ownsChildren: false });

    skills.disable();
    skills.push(skill);

    expect(skill.disabled.value).toBeTrue();
    expect(skills.detachAt(0)).toBe(skill);
    expect(skill.disabled.value).toBeFalse();

    skills.dispose();
    skill.dispose();
  });

  it('rejects duplicate list nodes and mutations after disposal', () => {
    const item = field('TypeScript');
    const skills = list([item], { ownsChildren: false });

    expect(() => skills.push(item)).toThrowError(
      'A form node cannot appear in the same list twice.',
    );

    skills.dispose();

    expect(() => skills.push(field('Angular'))).toThrowError(
      'Cannot mutate a disposed list.',
    );

    item.dispose();
  });

  it('rejects a field reused under multiple form keys', () => {
    const name = field('Ada');

    expect(() => form({ first: name, second: name })).toThrowError(
      'A form node cannot appear in the same form twice.',
    );

    name.dispose();
  });

  it('can enable an owning list after clearing parent-disabled items', () => {
    const skill = field('TypeScript');
    const skills = list([skill]);

    skills.disable();
    skills.clear();

    expect(() => skills.enable()).not.toThrow();
    expect(skills.disabled.value).toBeFalse();
    expect(skill.state.disposed).toBeTrue();

    skills.dispose();
  });

  it('runs initial async validation once and aborts it on disposal', async () => {
    let calls = 0;
    let activeSignal: AbortSignal | undefined;

    const name = field('Ada', {
      asyncChecks: (_value, signal) => {
        calls++;
        activeSignal = signal;

        return new Promise<null>(resolve => {
          signal.addEventListener('abort', () => resolve(null), { once: true });
        });
      },
    });

    expect(calls).toBe(1);
    expect(activeSignal).toBeDefined();
    expect(activeSignal!.aborted).toBeFalse();

    name.dispose();
    await Promise.resolve();

    expect(activeSignal!.aborted).toBeTrue();
    expect(calls).toBe(1);
  });

  it('batches list synchronization into one aggregate state update', () => {
    const first = field('TypeScript');
    const skills = list([first], { ownsChildren: false });
    const created: typeof first[] = [];
    let updates = 0;
    const unsubscribe = skills.state.subscribe(() => updates++);

    syncList(skills, ['Angular', 'RxJS', 'Signals'], value => {
      const skill = field(value);
      created.push(skill);
      return skill;
    });

    expect(skills.completeValue.value).toEqual(['Angular', 'RxJS', 'Signals']);
    expect(updates).toBe(1);

    unsubscribe();
    skills.dispose();
    first.dispose();
    created.forEach(skill => skill.dispose());
  });
});
