import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const createPlugin = require(resolve(process.cwd(), 'projects/libraries/streamix/vue/editor/tsserver.cjs')) as (context: {
  modules: { typescript: typeof ts };
}) => { compileSFCScript(lang: string, source: string): ts.SourceFile | undefined };

describe('Streamix Vue language plugin', () => {
  it('types raw atom reads in derived callbacks as values', () => {
    const plugin = createPlugin({ modules: { typescript: ts } });
    const source = `
      import { atom, derived } from '@epikodelabs/streamix';
      const price = atom(2);
      const quantity = atom(3);
      const total = derived(() => price * quantity);
    `;

    const virtual = plugin.compileSFCScript('ts', source);

    expect(virtual?.text).toContain('derived(() => price.value * quantity.value)');
    expect(source).toContain('derived(() => price * quantity)');
  });

  it('does not rewrite explicit value reads or non-Streamix functions', () => {
    const plugin = createPlugin({ modules: { typescript: ts } });
    const source = `
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(1);
      const explicit = derived(() => count.value + 1);
      const unrelated = derive(() => count);
    `;

    // With no compiler changes required, Vue Language Tools must use its
    // normal script parser rather than a fabricated SourceFile.
    expect(plugin.compileSFCScript('ts', source)).toBeUndefined();
  });

  it('does not corrupt derived strings, comments, object literals or local shadows', () => {
    const plugin = createPlugin({ modules: { typescript: ts } });
    const source = `
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(2);
      const a = derived(() => "count");
      const b = derived(() => ({ count }));
      const c = derived(() => { /* count */ const count = 4; return count; });
    `;
    const code = plugin.compileSFCScript('ts', source)?.text;
    expect(code).toContain('"count"');
    expect(code).toContain('({ count: count.value })');
    expect(code).toContain('/* count */ const count = 4; return count;');
  });

});

describe('Vue editor production compatibility', () => {
  it('uses the upstream lang-then-script hook and accepted API version', () => {
    const plugin = createPlugin({ modules: { typescript: ts } }) as ReturnType<typeof createPlugin> & { version: number };
    expect(plugin.version).toBe(2.1);
    const source = `import { atom, derived } from '@epikodelabs/streamix'; const count = atom(2); const result = derived(() => count * 2);`;
    expect(plugin.compileSFCScript('ts', source)?.text).toContain('count.value * 2');
    expect(plugin.compileSFCScript(source, 'ts')).toBeUndefined();
  });

  it('preserves both arrow and function callback parameters that shadow atoms', () => {
    const plugin = createPlugin({ modules: { typescript: ts } });
    const source = `
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(2);
      const a = derived((count) => count * 2);
      const b = derived(function(count) { return count * 2; });
      const c = derived(() => count * 2);
    `;
    const transformed = plugin.compileSFCScript('ts', source)?.text;
    expect(transformed).toContain('derived((count) => count * 2)');
    expect(transformed).toContain('derived(function(count) { return count * 2; })');
    expect(transformed).toContain('derived(() => count.value * 2)');
  });

  it('preserves DerivedScope dependencies and rewrites nested derived callbacks once', () => {
    const plugin = createPlugin({ modules: { typescript: ts } });
    const source = `
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(2);
      const tracked = derived($ => $(count));
      const nested = derived(() => derived(() => count));
    `;
    const transformed = plugin.compileSFCScript('ts', source)?.text;
    expect(transformed).toContain('derived($ => $(count))');
    expect(transformed).toContain('derived(() => derived(() => count.value))');
    expect(transformed).not.toContain('count.value.value');
  });
});
