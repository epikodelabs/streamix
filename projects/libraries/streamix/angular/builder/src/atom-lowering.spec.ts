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
  return new Function('atom', 'derived', `${body}\nreturn { count, enabled, summary };`)(atom, derived);
}

for (const [name, compile] of Object.entries(compilers)) {
  describe(`${name} atom lowering execution`, () => {
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
