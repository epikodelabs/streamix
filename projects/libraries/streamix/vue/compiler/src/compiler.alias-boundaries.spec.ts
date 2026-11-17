import ts from 'typescript';
import * as vue from 'vue';
import { compileScript, parse } from '@vue/compiler-sfc';
import { atom } from '@epikodelabs/streamix';
import { useWritable } from '../../src/lib/useWritable';
import { transformVueSfc } from './compiler';
import { transformAngularComponentTemplate } from '../../../angular/compiler/src/build-transform';
import { rewriteDerivedAtomReads } from '../../../angular/builder/src/generate-project';

describe('framework nested alias boundaries', () => {
  const bodies = [
    'if (true) { const alias = count; return alias.value; }',
    'switch (true) { case true: { const { count: alias } = { count }; return alias.value; } }',
    'try { const [alias] = [count]; return alias.value; } finally {}',
  ];
  for (const body of bodies) {
    it(`Vue preserves explicit script reads: ${body}`, () => {
      const source = atom(1);
      const result = transformVueSfc(`<script setup lang="ts">
        import { atom } from '@epikodelabs/streamix';
        const count = atom(1);
        function readAlias() { ${body} }
      </script><template>{{ count }}</template>`);
      expect(result.diagnostics).toEqual([]);
      expect(result.bindingCount).toBe(1);
      const script = compileScript(parse(result.code).descriptor, { id: 'alias-parity' }).content;
      const javascript = ts.transpileModule(script, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const exports = { default: undefined as unknown as { setup(props: object, context: object): { readAlias(): number } } };
      new Function('require', 'exports', javascript)((name: string) => {
        if (name === 'vue') return vue;
        if (name === '@epikodelabs/streamix') return { atom: () => source };
        if (name === '@epikodelabs/streamix/vue') return { useWritable };
        throw new Error(`Unexpected import ${name}`);
      }, exports);
      const scope = vue.effectScope();
      try {
        const bindings = scope.run(() => exports.default.setup({}, { expose() {} }))!;
        expect(bindings.readAlias()).toBe(1);
        source.next(2);
        expect(bindings.readAlias()).toBe(2);
      } finally { scope.stop(); source.dispose(); }
    });

    it(`Angular preserves explicit TypeScript reads: ${body}`, () => {
      const input = `class Counter { count = atom(1); readAlias() { const count = this.count; ${body} } }`;
      const code = rewriteDerivedAtomReads(input);
      expect(code).toBe(input);
      const Counter = new Function('atom', `${code}; return Counter;`)(atom);
      const instance = new Counter();
      try {
        expect(instance.readAlias()).toBe(1);
        instance.count.next(2);
        expect(instance.readAlias()).toBe(2);
      } finally { instance.count.dispose(); }
    });
  }

  it('Angular rejects an unsupported root template alias of a source', () => {
    expect(() => transformAngularComponentTemplate('@let alias = count; <p>{{ alias }}</p>', 'alias.html', {
      resolveReactiveSource: path => path === 'count' ? 'count' : undefined,
    })).toThrowError(/cannot bind "count"/);
  });
});
