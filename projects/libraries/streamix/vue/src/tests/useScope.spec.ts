import {
    scope,
    type Scope,
} from '@epikodelabs/streamix';
import {
    effectScope,
    type EffectScope,
} from 'vue';
import { useScope } from '../lib/useScope';

describe('useScope', () => {
  let vueScope: EffectScope;

  beforeEach(() => {
    vueScope = effectScope();
  });

  afterEach(() => {
    vueScope.stop();
  });

  it('creates one Streamix scope per composable invocation', () => {
    let calls = 0;

    const state = vueScope.run(() => useScope(() => {
      calls++;
      return scope({ count: 0 });
    }))!;

    expect(calls).toBe(1);
    expect(state.count).toBe(0);
  });

  it('fails before creating a Streamix scope without Vue ownership', () => {
    let calls = 0;

    expect(() => useScope(() => {
      calls++;
      return scope({ count: 0 });
    })).toThrowError(/active effectScope/);
    expect(calls).toBe(0);
  });

  it('disposes the Streamix scope when the Vue effect scope stops', () => {
    let created!: Scope;

    vueScope.run(() => {
      const state = useScope(() => scope({ count: 0 }));
      created = state as unknown as Scope;
    });

    expect(created._disposed).toBe(false);
    vueScope.stop();
    expect(created._disposed).toBe(true);
  });
});
