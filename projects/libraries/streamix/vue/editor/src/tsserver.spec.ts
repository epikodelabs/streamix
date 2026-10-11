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

    const virtual = plugin.compileSFCScript('ts', source);

    expect(virtual?.text).toContain('derived(() => count.value + 1)');
    expect(virtual?.text).toContain('derive(() => count)');
  });
});
