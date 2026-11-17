import ts from 'typescript';
import { atom, derived } from '../../../src/lib/atoms/atom';
import { transformReactJsx } from '../../../react/compiler/src/compiler';
import { transformVueSfc } from '../../../vue/compiler/src/compiler';
import { rewriteDerivedAtomReads } from './generate-project';

const compilers = {
  Angular: rewriteDerivedAtomReads,
  React: (source: string) => transformReactJsx(source).code,
  Vue: (source: string) => {
    const result = transformVueSfc(`<script setup lang="ts">${source}</script><template>{{ summary }}</template>`);
    expect(result.diagnostics).toEqual([]);
    return result.code.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1];
  },
};

// Execute the actual lowered declarations without framework bridge setup.
// This checks dependency tracking and updates, beyond printed output alone.
function execute(code: string): any {
  const file = ts.createSourceFile('lowered.ts', code, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter();
  const statements = file.statements.filter(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.every(declaration =>
      ts.isIdentifier(declaration.name) && !declaration.name.text.startsWith('__')));
  const body = statements.map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, file)).join('\n');
  const javascript = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('atom', 'derived', `${javascript}\nreturn { count, enabled, summary };`)(atom, derived);
}

for (const [name, compile] of Object.entries(compilers)) {
  describe(`${name} atom lowering execution`, () => {
    it('resolves hoisted vars and class bindings without hiding genuine outer reads', () => {
      const state = execute(compile(`
        import { atom, derived } from '@epikodelabs/streamix';
        const count = atom(2);
        const enabled = atom(true);
        const summary = derived(() => {
          const hoisted = (() => { if (true) { var count = 7; } return count; })();
          const branch = (() => { switch (1) { case 1: const count = 3; return count; default: return 0; } })();
          const localClass = (() => { class count { static value = 4; } return count.value; })();
          const outer = (() => { function unrelated() { var count = 999; return count; } return count; })();
          return hoisted + branch + localClass + outer;
        });
      `));
      expect(state.summary.value).toBe(16);
      state.count.set(3);
      expect(state.summary.value).toBe(17);
      state.summary.dispose();
      state.count.dispose();
      state.enabled.dispose();
    });

    it('adopts let/var declarations and composed casts without changing runtime values', () => {
      const state = execute(compile(`
        import { atom, derived, type Writable } from '@epikodelabs/streamix';
        let count = ((atom(2)) as Writable<number>) satisfies Writable<number>;
        var enabled = (atom(true));
        const summary = (derived(() => enabled ? count * 2 : 0));
      `));
      expect(state.summary.value).toBe(4);
      state.count.set(3);
      expect(state.summary.value).toBe(6);
      state.summary.dispose();
      state.count.dispose();
      state.enabled.dispose();
    });

    it('keeps loop, catch, destructuring and switch shadows separate from outer atoms', () => {
      const state = execute(compile(`
        import { atom, derived } from '@epikodelabs/streamix';
        const count = atom(2);
        const enabled = atom(true);
        const summary = derived(() => {
          let sum = count;
          for (const { count } of [{count: 3}]) sum += count;
          for (const count in {a: 1}) sum += count.length;
          for (let count = 0; count < 2; count++) sum += count;
          try { throw {count: 4}; } catch ({count}) { sum += count; }
          switch (1) { case 1: const count = 5; sum += count; break; default: break; }
          switch (0) { default: const count = 6; sum += count; }
          return sum;
        });
      `));
      expect(state.summary.value).toBe(22);
      state.count.set(3);
      expect(state.summary.value).toBe(23);
      state.summary.dispose();
      state.count.dispose();
      state.enabled.dispose();
    });

    it('tracks chained formulas, templates, object members and conditional dependencies', () => {
      const state = execute(compile(`
        import { atom, derived } from '@epikodelabs/streamix';
        const count = atom(2);
        const enabled = atom(true);
        const profile = atom({ name: 'Ada' });
        const doubled = derived(() => count * 2);
        const summary = derived(() => ({
          doubled,
          label: enabled ? \`count is \${count}\` : profile.name,
        }));
      `));
      const seen: unknown[] = [];
      const unsubscribe = state.summary.subscribe((value: unknown) => seen.push(value));
      expect(state.summary.value).toEqual({ doubled: 4, label: 'count is 2' });
      state.count.set(3);
      expect(state.summary.value).toEqual({ doubled: 6, label: 'count is 3' });
      state.enabled.set(false);
      expect(state.summary.value).toEqual({ doubled: 6, label: 'Ada' });
      expect(seen.length).toBe(3);
      unsubscribe();
      state.summary.dispose();
    });

    it('keeps callable and method reader arguments as atom references', () => {
      const state = execute(compile(`
        import { atom, derived } from '@epikodelabs/streamix';
        const count = atom(2);
        const enabled = atom(true);
        const summary = derived(self => self(count) + self.read(count));
      `));
      expect(state.summary.value).toBe(4);
      state.count.set(5);
      expect(state.summary.value).toBe(10);
      state.summary.dispose();
    });
  });
}
