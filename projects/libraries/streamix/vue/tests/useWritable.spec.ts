import {
  effectScope,
  type EffectScope,
} from 'vue';
import { atom } from '@epikodelabs/streamix';
import { useWritable } from '../src/lib/useWritable';

describe('useWritable', () => {
  let vueScope: EffectScope;

  beforeEach(() => {
    vueScope = effectScope();
  });

  afterEach(() => {
    vueScope.stop();
  });

  it('reads from and writes directly to the Streamix Writable', () => {
    const source = atom(0);
    const value = vueScope.run(() => useWritable(source))!;

    expect(value.value).toBe(0);

    value.value = 1;
    expect(source.value).toBe(1);
    expect(value.value).toBe(1);
  });

  it('stays synchronized with writes from outside Vue', () => {
    const source = atom(0);
    const value = vueScope.run(() => useWritable(source))!;

    source.next(5);
    expect(value.value).toBe(5);
  });
});
