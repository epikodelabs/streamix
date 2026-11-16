import { NO_INITIAL_VALUE, atom } from '@epikodelabs/streamix';
import { transformAngularComponentTemplate } from './build-transform';
import { installSxLifecycleIntoComponentSource } from './install-lifecycle';

describe('Angular pending SSR fallbacks', () => {
  const options = { resolveReactiveSource: (path: string) => ['count', 'total'].includes(path) ? path : undefined };

  it('guards interpolation expressions before evaluating pending dependencies', () => {
    const result = transformAngularComponentTemplate('<output>{{ count + total }}</output>', 'pending.html', options);
    const expression = /{{ ([\s\S]*?) }}/.exec(result.template)![1];
    const evaluate = new Function('count', 'total', '__sxNoInitialValue', '$any', `return ${expression};`);
    const count = atom<number>();
    const total = atom(2);
    expect(evaluate(count, total, NO_INITIAL_VALUE, (value: unknown) => value)).toBeUndefined();
    count.next(3);
    expect(evaluate(count, total, NO_INITIAL_VALUE, (value: unknown) => value)).toBe(5);
    count.dispose();
    total.dispose();
  });

  it('installs the sentinel identity used by the generated template', () => {
    const result = transformAngularComponentTemplate('<output>{{ count }}</output>', 'pending.html', options);
    const installed = installSxLifecycleIntoComponentSource('export class View {}', {
      inlineSetup: result.setup,
      sourceReferenceFields: result.sourceReferenceFields,
    });
    expect(installed.source).toContain('public readonly __sxNoInitialValue = ɵsxNoInitialValue');
    expect(installed.source).toMatch(/import \{[^}]*ɵsxNoInitialValue[^}]*\} from "@epikodelabs\/streamix\/angular"/);
  });

  it('rejects an authored member that would replace the pending guard identity', () => {
    expect(() => installSxLifecycleIntoComponentSource('export class View { __sxNoInitialValue = null; }', {
      sourceReferenceFields: ['count'],
    })).toThrowError(/reserved for generated Streamix pending-value guards/);
  });
});
