import {
  method,
  scope,
} from '@epikodelabs/streamix';
import {
  effectScope,
  type EffectScope,
} from 'vue';
import { useScopeMember } from '../lib/useIterable';

describe('useScopeMember', () => {
  let vueScope: EffectScope;

  beforeEach(() => {
    vueScope = effectScope();
  });

  afterEach(() => {
    vueScope.stop();
  });

  it('bridges a source member and stays live', () => {
    const state = scope({ count: 0 });
    const count = vueScope.run(() => useScopeMember(state.get('count'), 'state.count'))!;

    expect((count as { value: number }).value).toBe(0);
    state.set('count', 1);
    expect((count as { value: number }).value).toBe(1);

    state.dispose();
  });

  it('returns a method untouched instead of invoking it as a factory', () => {
    let calls = 0;
    const state = scope({
      count: 0,
      increment: method((self: any) => { calls++; self.set('count', self.count + 1); }),
    });

    const increment = vueScope.run(() =>
      useScopeMember(state.get('increment'), 'state.increment'))!;

    expect(calls).toBe(0);
    expect(typeof increment).toBe('function');
    (increment as () => void)();
    expect(calls).toBe(1);
    expect(state.count).toBe(1);

    state.dispose();
  });

  it('returns a nested scope untouched instead of invoking it as a factory', () => {
    const state = scope({ profile: { name: 'Ada' } });

    const profile = vueScope.run(() =>
      useScopeMember(state.get('profile'), 'state.profile'))!;

    expect(profile).toBe(state.get('profile'));
    expect((profile as { get(key: string): { value: unknown } }).get('name').value).toBe('Ada');

    state.dispose();
  });
});
