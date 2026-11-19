import { atom } from '@epikodelabs/streamix';
import {
    effectScope,
    watchEffect,
    type EffectScope,
} from 'vue';
import { useWritable } from '../lib/useWritable';

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

  it('notifies a synchronous watcher once per direct write', () => {
    const source = atom(0);
    const value = vueScope.run(() => useWritable(source))!;
    let runs = 0;
    const stop = vueScope.run(() => watchEffect(() => {
      void value.value;
      runs += 1;
    }, { flush: 'sync' }))!;

    const initial = runs;

    value.value = 1;
    expect(runs - initial).toBe(1);

    source.next(2);
    expect(runs - initial).toBe(2);

    stop();
    source.dispose();
  });
});
