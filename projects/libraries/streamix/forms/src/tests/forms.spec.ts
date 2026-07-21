import { atom } from '@epikodelabs/streamix';
import { bindField, field, form, list, syncList } from '@epikodelabs/streamix/forms';

describe('Forms', () => {
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
