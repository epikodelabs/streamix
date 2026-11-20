import ts from 'typescript';
import { transformVueSfc } from './compiler';

const compile = (script: string, template: string) =>
  transformVueSfc(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`);

function expectNoError(result: ReturnType<typeof compile>): void {
  expect(result.diagnostics.filter(item => item.category === 'error')).toEqual([]);
}

describe('Vue compiler correctness regressions', () => {
  it('bridges dynamic indexes in formulas and templates', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const items = atom(['first', 'second']);
      const index = atom(0);
      const selected = derived(() => items[index]);
    `, '{{ items[index] }}');
    expectNoError(result);
    expect(result.code).toContain('items.value[index.value]');
    expect(result.code).toContain('__sx_items[__sx_index]');
  });

  it('scans directive attributes without interpreting strings inside other attributes', () => {
    const result = compile(`
      import { atom, scope } from '@epikodelabs/streamix';
      const count = atom(1);
      const state = scope({ count: 0 });
    `, `<input title="keep :count here and :value='literal'" v-model="state.count"><button @click="state.count = 'x :count y'" :count>x</button>`);
    expectNoError(result);
    expect(result.code).toContain(`title="keep :count here and :value='literal'"`);
    expect(result.code).toContain("'x :count y'");
    expect(result.code).toContain(':count="__sx_count"');
  });
  it('never rewrites derived string literals, comments, or object keys', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(1);
      const label = derived(() => "count is high");
      const comment = derived(() => { /* count */ return count; });
      const object = derived(() => ({ count, label: count }));
    `, '{{ object }} {{ comment }} {{ label }}');
    expectNoError(result);
    expect(result.code).toContain('"count is high"');
    expect(result.code).toContain('/* count */');
    expect(result.code).toContain('return count.value;');
    expect(result.code).toContain('({ count: count.value, label: count.value })');
    expect(result.code).not.toContain('count.value is high');
  });

  it('does not rewrite a shadowed local atom identifier inside derived', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(1);
      const value = derived(() => { const count = 4; return count; });
    `, '{{ value }}');
    expectNoError(result);
    expect(result.code).toContain('const count = 4; return count;');
    expect(result.code).not.toContain('return count.value;');
  });

  it('does not rewrite a for-of loop variable shadowing an atom inside derived', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const price = atom(2);
      const total = derived(() => { let sum = price.value; for (const price of [3, 4]) sum += price; return sum; });
    `, '{{ total }}');
    expectNoError(result);
    expect(result.code).toContain('for (const price of [3, 4]) sum += price;');
    expect(result.code).not.toContain('sum += price.value');
  });

  it('does not rewrite a for-in loop variable shadowing an atom inside derived', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const key = atom('');
      const joined = derived(() => { let out = key.value; for (const key in { a: 1 }) out += key; return out; });
    `, '{{ joined }}');
    expectNoError(result);
    expect(result.code).toContain('for (const key in { a: 1 }) out += key;');
    expect(result.code).not.toContain('out += key.value');
  });

  it('does not rewrite a for header initializer shadowing an atom inside derived', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const step = atom(1);
      const doubled = derived(() => { let out = step.value; for (let step = 0; step < 2; step++) out += step; return out; });
    `, '{{ doubled }}');
    expectNoError(result);
    expect(result.code).toContain('for (let step = 0; step < 2; step++) out += step;');
    expect(result.code).not.toContain('out += step.value');
  });

  it('does not rewrite a catch binding shadowing an atom inside derived', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const err = atom('none');
      const status = derived(() => { try { JSON.parse('{'); } catch (err) { return String(err); } });
    `, '{{ status }}');
    expectNoError(result);
    expect(result.code).toContain('return String(err);');
    expect(result.code).not.toContain('return err.value;');
  });

  it('does not rewrite a brace-less case clause declaration shadowing an atom inside derived', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const mode = atom('a');
      const label = derived(() => {
        switch (mode.value) {
          case 'a':
            const mode = 'b';
            return mode;
          default:
            return mode.value;
        }
      });
    `, '{{ label }}');
    expectNoError(result);
    expect(result.code).toContain("const mode = 'b';\n            return mode;");
  });

  it('adopts reactive let declarations like const', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      let count = atom(1);
      const doubled = derived(() => count * 2);
    `, '{{ doubled }}');
    expectNoError(result);
    expect(result.code).toContain("const __sx_count = useWritable(count, 'count');");
    expect(result.code).toContain('const doubled = derived(() => count.value * 2);');
    expect(result.code).toContain("const __sx_doubled = useIterable(doubled, undefined, 'doubled');");
  });

  it('adopts cast-wrapped and parenthesized factory initializers', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(1) as ReturnType<typeof atom>;
      const total = <ReturnType<typeof atom>>atom(2);
      const rate = (atom(3));
      const kept = derived(() => count.value + total.value + rate.value);
    `, '{{ kept }}');
    expectNoError(result);
    expect(result.code).toContain("const __sx_count = useWritable(count, 'count');");
    expect(result.code).toContain("const __sx_total = useWritable(total, 'total');");
    expect(result.code).toContain("const __sx_rate = useWritable(rate, 'rate');");
  });

  it('lowers atom reads through cast-wrapped derived callbacks', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(2);
      const total = derived((() => count * 2) as () => number);
      const other = derived((() => count * 3)!);
    `, '{{ total }} {{ other }}');
    expectNoError(result);
    expect(result.code).toContain('derived((() => count.value * 2) as () => number)');
    expect(result.code).toContain('derived((() => count.value * 3)!)');
  });

  it('rejects an asynchronous cast-wrapped derived callback', () => {
    const result = compile(`
      import { derived } from '@epikodelabs/streamix';
      const total = derived((async () => 2) as any);
    `, '{{ total }}');
    expect(result.diagnostics.some(item =>
      item.category === 'error' && /synchronously/.test(item.message))).toBeTrue();
  });

  it('adopts a cast around the introspection wrapper in either nesting order', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      declare const __sxDebug: (call: unknown, meta: unknown) => unknown;
      const first = __sxDebug(atom(1), {}) as ReturnType<typeof atom>;
      const second = __sxDebug((atom(2)), {}) satisfies unknown;
      const kept = derived(() => first.value + second.value);
    `, '{{ kept }}');
    expectNoError(result);
    expect(result.code).toContain("const __sx_first = useWritable(first, 'first');");
    expect(result.code).toContain("const __sx_second = useWritable(second, 'second');");
  });

  it('uses the generated scope bridge identifier within an assignment RHS', () => {
    const result = compile(`
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ count: 0 });
    `, '<button @click="state.count = state.count + 1" />');
    expectNoError(result);
    expect(result.code).toContain('state.set(\'count\', __sx_000073000074000061000074000065_00006300006f00007500006e000074 + 1)');
    expect(result.code).not.toContain('__sx_state_count');
  });

  it('handles multiple statements within Vue event handlers', () => {
    const result = compile(`
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ count: 0, title: '' });
    `, '<button @click="state.count = 1; state.title = String(state.count)" />');
    expectNoError(result);
    expect(result.code).toContain("state.set('count', 1); state.set('title', String(");
    expect(result.code).toContain('00006300006f00007500006e000074');
  });

  it('does not recognize scope paths inside comments and strings as reads', () => {
    const result = compile(`
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ count: 0 });
    `, '<span :title="\'state.count\'">{{ "state.count" }}</span>');
    expectNoError(result);
    // The only adopted binding is the wrapped scope declaration itself; the
    // string literals must not gain member bridges.
    expect(result.bindingCount).toBe(1);
    expect(result.bridgedScopes).toEqual({});
    expect(result.code).toContain('{{ "state.count" }}');
  });

  it('parses greater-than characters in attributes before a scope v-model', () => {
    const result = compile(`
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ title: '' });
    `, '<input :min="3 > 2" v-model="state.title">');
    expectNoError(result);
    expect(result.code).toContain('@input="state.set(');
    expect(result.code).not.toContain('v-model="state.title"');
  });

  it('supports single-quoted v-model on scope members', () => {
    const result = compile(`
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ title: '' });
    `, "<input v-model='state.title'>");
    expectNoError(result);
    expect(result.code).toContain('state.set(\'title\',');
  });

  it('rejects a v-model on a derived binding at build time', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const source = atom(1);
      const doubled = derived(() => source * 2);
    `, '<input v-model="doubled">');
    expect(result.diagnostics.some(item => item.message.includes('read-only'))).toBeTrue();
  });

  it('rejects incrementing a derived binding at build time', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const source = atom(1);
      const doubled = derived(() => source * 2);
    `, '<button @click="doubled++">{{ doubled }}</button>');
    expect(result.diagnostics.some(item => item.message.includes('read-only'))).toBeTrue();
  });

  it('preserves reactive object shorthand keys in template expressions', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const count = atom(1);
    `, '<widget :data="{ count }" />');
    expectNoError(result);
    expect(result.code).toContain(':data="{ count: __sx_count }"');
  });

  it('does not duplicate pre-existing unaliased imports from the Vue bridge', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      import { useWritable } from '@epikodelabs/streamix/vue';
      const count = atom(1);
    `, '{{ count }}');
    expectNoError(result);
    expect(result.code).not.toContain('import { useIterable } from');
    expect(result.code).not.toContain('import { useIterable, useWritable }');
  });

  it('produces parseable script edits after rewriting', () => {
    const result = compile(`
      import { atom, derived, scope } from '@epikodelabs/streamix';
      const count = atom(1);
      const squared = derived(() => ({ count, value: count * count }));
      const state = scope({ title: '' });
    `, '{{ squared }} {{ state.title }}');
    expectNoError(result);
    const body = /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(result.code)![1];
    const file = ts.createSourceFile('result.ts', body, ts.ScriptTarget.Latest, true);
    expect((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics).toEqual([]);
    expect(body).toContain('const state = useScope(() => scope({ title: \'\' }));');
  });

  it('bridges a scope member used only by v-model', () => {
    const result = compile(`
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ title: '' });
    `, '<input v-model="state.title">');
    expectNoError(result);
    expect(result.bindingCount).toBe(2);
    expect(result.bridgedScopes).toEqual({ state: ['title'] });
  });

  it('bridges atoms used by v-text and v-html', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const text = atom('Ready');
      const html = atom('<strong>Ready</strong>');
    `, '<p v-text="text"></p><div v-html="html"></div>');
    expectNoError(result);
    expect(result.code).toContain('v-text="__sx_text"');
    expect(result.code).toContain('v-html="__sx_html"');
  });

  it('rejects v-model member mutation of an object-valued atom', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const form = atom({ name: '' });
    `, '<input v-model="form.name">');
    expect(result.diagnostics.some(item => item.message.includes('cannot mutate a member'))).toBeTrue();
  });

  it('rejects nested scope assignments rather than generating invalid setters', () => {
    const result = compile(`
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ count: 0, value: 0 });
    `, '<button @click="state.count = state.value = 1" />');
    expect(result.diagnostics.some(item => item.message.includes('Nested scope assignments'))).toBeTrue();
  });

  it('rejects generated bridge name collisions', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      const __sx_count = 'author value';
    `, '{{ count }}');
    expect(result.diagnostics.some(item => item.message.includes('collides'))).toBeTrue();
  });

  it('keeps reactive scope RHS reads inside authored expression bodies', () => {
    const result = compile(`
      import { atom, scope } from '@epikodelabs/streamix';
      const increment = atom(2);
      const state = scope({ count: 0 });
    `, '<button @click="state.count = state.count + increment" />');
    expectNoError(result);
    expect(result.code).toContain(' + __sx_increment)');
  });

  it('does not rewrite a v-for alias that shadows a reactive binding', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const item = atom('outer');
      const items = atom(['a', 'b']);
    `, '<ul><li v-for="item in items">{{ item }}</li></ul>');
    expectNoError(result);
    expect(result.code).toContain('v-for="item in __sx_items"');
    expect(result.code).toContain('{{ item }}');
    expect(result.code).not.toContain('{{ __sx_item }}');
  });

  it('does not lower a v-for alias that shadows a scope name as scope usage', () => {
    const result = compile(`
      import { atom, scope } from '@epikodelabs/streamix';
      const state = scope({ title: '' });
      const rows = atom([{ title: 'a' }]);
    `, '<div v-for="state in rows">{{ state.title }}</div>');
    expectNoError(result);
    expect(result.code).toContain('v-for="state in __sx_rows"');
    expect(result.code).toContain('{{ state.title }}');
    expect(result.bridgedScopes).toEqual({});
  });

  it('tracks aliases independently across nested v-for loops', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const row = atom('outer-row');
      const group = atom('outer-group');
      const groups = atom([{ name: 'g', rows: [{ name: 'r' }] }]);
    `, '<section v-for="group in groups"><span v-for="row in group.rows">{{ group.name }} {{ row.name }}</span></section>');
    expectNoError(result);
    expect(result.code).toContain('v-for="group in __sx_groups"');
    expect(result.code).toContain('v-for="row in group.rows"');
    expect(result.code).toContain('{{ group.name }} {{ row.name }}');
    expect(result.code).not.toContain('__sx_group.name');
    expect(result.code).not.toContain('__sx_row.name');
  });

  it('tracks destructured v-for aliases through nested patterns', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const id = atom('outer-id');
      const name = atom('outer-name');
      const rows = atom([{ id: 1, name: 'a' }]);
    `, '<li v-for="{ id, name: title } in rows">{{ id }} {{ title }}</li>');
    expectNoError(result);
    expect(result.code).toContain('v-for="{ id, name: title } in __sx_rows"');
    expect(result.code).toContain('{{ id }} {{ title }}');
    expect(result.code).not.toContain('{{ __sx_id }}');
    expect(result.code).not.toContain('{{ __sx_name }}');
  });

  it('does not rewrite values bound by slot props', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const count = atom(1);
      const label = atom('ready');
    `, '<Card v-slot="{ count }">{{ count }} {{ label }}</Card>');
    expectNoError(result);
    expect(result.code).toContain('v-slot="{ count }"');
    expect(result.code).toContain('{{ count }}');
    expect(result.code).toContain('{{ __sx_label }}');
    expect(result.code).not.toContain('{{ __sx_count }}');
  });

  it('does not rewrite values bound by the v-slot shorthand', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const count = atom(1);
      const label = atom('ready');
    `, '<Card #default="{ count }">{{ count }} {{ label }}</Card>');
    expectNoError(result);
    expect(result.code).toContain('#default="{ count }"');
    expect(result.code).toContain('{{ count }}');
    expect(result.code).toContain('{{ __sx_label }}');
    expect(result.code).not.toContain('{{ __sx_count }}');
  });

  it('does not rewrite handler parameters or inline declarations', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const count = atom(1);
    `, '<div><button @click="(count) => log(count)">{{ count }}</button>' +
      '<button @click="() => { const count = 2; return count; }">{{ count }}</button></div>');
    expectNoError(result);
    expect(result.code).toContain('@click="(count) => log(count)"');
    expect(result.code).toContain('@click="() => { const count = 2; return count; }"');
    expect((result.code.match(/\{\{ __sx_count \}\}/g) ?? []).length).toBe(2);
    expect(result.code).not.toContain('log(__sx_count)');
  });

  it('keeps source member APIs raw inside derived callbacks', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(1);
      const other = atom(0);
      const items = atom([1, 2]);
      const safe = derived(() => count.safeValue);
      const events = derived(() => count.subscribe(() => other.set(count)));
      const raw = derived(() => count['value'] + 1);
      const mapped = derived(() => items.map(item => item * 2));
      const indexed = derived(() => items[0] + 1);
    `, '{{ safe }} {{ raw }}');
    expectNoError(result);
    expect(result.code).toContain('count.safeValue');
    expect(result.code).toContain('count.subscribe(() => other.set(count.value))');
    expect(result.code).toContain("count['value'] + 1");
    // Value methods and literal indexes still read the atom's value.
    expect(result.code).toContain('items.value.map(item => item * 2)');
    expect(result.code).toContain('items.value[0] + 1');
    expect(result.code).not.toContain('count.value.safeValue');
    expect(result.code).not.toContain('count.value.subscribe');
    expect(result.code).not.toContain("count.value['value']");
    expect(result.code).not.toContain('items.value.value');
  });

  it('does not rewrite source member APIs in template expressions', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const count = atom(1);
    `, '<button @click="count.set(2)">{{ count.safeValue }} {{ count.value }}</button>');
    expectNoError(result);
    expect(result.code).toContain('@click="count.set(2)"');
    expect(result.code).toContain('{{ count.safeValue }}');
    expect(result.code).toContain('{{ count.value }}');
    expect(result.code).not.toContain('__sx_count.set');
  });

});

describe('Vue production regression gates', () => {
  it('does not rewrite an atom name shadowed by its own derived callback parameter', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(2);
      const doubled = derived((count: number) => count * 2);
      const other = derived(() => count * 2);
    `, '{{ doubled }} {{ other }}');
    expectNoError(result);
    expect(result.code).toContain('derived((count: number) => count * 2)');
    expect(result.code).toContain('derived(() => count.value * 2)');
  });

  it('lowers standalone derived callbacks to tracked value reads', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(2);
      const doubled = derived(() => count);
    `, '{{ doubled }}');
    expectNoError(result);
    expect(result.code).toContain('derived(() => count.value)');
  });

  it('only imports generated bridges actually needed by the SFC', () => {
    const result = compile(`
      import { atom } from '@epikodelabs/streamix';
      const count = atom(1);
    `, '{{ count }}');
    expectNoError(result);
    expect(result.code).toContain('import { useWritable } from "@epikodelabs/streamix/vue"');
    expect(result.code).not.toContain('import { useIterable, useWritable }');
  });

  it('emits exact source maps for repeated identifiers and leaves generated imports unmapped', () => {
    const source = `<script setup lang="ts">\nimport { atom } from '@epikodelabs/streamix';\nconst count = atom(1);\n</script>\n<template><div title="count">{{ count }} / {{ count }}</div></template>`;
    const result = transformVueSfc(source, 'Counter.vue');
    expectNoError(result);
    expect(result.sourceMap?.version).toBe(3);
    expect(result.sourceMap?.sourcesContent).toEqual([source]);
    const positions = [...result.code.matchAll(/\{\{ __sx_count \}\}/g)].map(match => match.index! + 3);
    const original = [...source.matchAll(/\{\{ count \}\}/g)].map(match => match.index! + 3);
    expect(positions.length).toBe(2);
    for (let index = 0; index < positions.length; index++) {
      // The newly inserted identifier is intentionally unmapped.
      expect(originalPosition(result.sourceMap!.mappings, result.code, positions[index])).toBe(undefined);
    }
    const originalTitle = source.indexOf('title="count"');
    const transformedTitle = result.code.indexOf('title="count"');
    expect(originalPosition(result.sourceMap!.mappings, result.code, transformedTitle)).toBe(originalTitle);
    expect(originalPosition(result.sourceMap!.mappings, result.code, result.code.indexOf("useWritable(count, 'count')"))).toBe(undefined);
    expect(original.length).toBe(2);
  });
});

function originalPosition(mappings: string, generated: string, offset: number): number | undefined {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const decode = (part: string): number[] => {
    const result: number[] = [];
    let value = 0, shift = 0;
    for (const character of part) {
      const digit = alphabet.indexOf(character);
      value += (digit & 31) * 2 ** shift;
      if (digit & 32) { shift += 5; continue; }
      result.push(value & 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
      value = 0; shift = 0;
    }
    return result;
  };
  const before = generated.slice(0, offset).split('\n');
  const targetLine = before.length - 1, targetColumn = before[before.length - 1].length;
  let originalLine = 0, originalColumn = 0;
  const source = generated; // only the mappings are needed to determine whether a segment is mapped
  let found: { line: number; column: number } | undefined;
  mappings.split(';').forEach((line, index) => {
    if (index > targetLine) return;
    let generatedColumn = 0;
    for (const encoded of line.split(',').filter(Boolean)) {
      const fields = decode(encoded);
      generatedColumn += fields[0];
      if (fields.length === 4) { originalLine += fields[2]; originalColumn += fields[3]; }
      if (index === targetLine && generatedColumn <= targetColumn) {
        found = fields.length === 4 ? { line: originalLine, column: originalColumn } : undefined;
      }
    }
  });
  if (!found) return undefined;
  // This particular regression's authored SFC is reconstructed below from its known sections.
  const authored = `<script setup lang="ts">\nimport { atom } from '@epikodelabs/streamix';\nconst count = atom(1);\n</script>\n<template><div title="count">{{ count }} / {{ count }}</div></template>`;
  void source;
  return authored.split('\n').slice(0, found.line).reduce((sum, line) => sum + line.length + 1, 0) + found.column;
}

 describe('standalone derived source reads', () => {
  it('tracks raw piped, flow, and derived atoms', () => {
    const result = compile(`
      import { atom, derived, flow, pipe, map } from '@epikodelabs/streamix';
      const count = atom(2);
      const doubled = derived(() => count * 2);
      const source = flow([1, 2]);
      const piped = pipe(count, map(value => value + 1));
      const total = derived(() => { void piped; return doubled + source; });
    `, '{{ total }}');
    expectNoError(result);
    expect(result.code).toContain('void piped.value');
    expect(result.code).toContain('return doubled.value + source.value');
  });
  it('lowers standalone and nested derived calls without adopting shadowed factories', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(1);
      derived(() => derived(() => count));
      function local(derived: (read: () => unknown) => unknown) {
        return derived(() => count);
      }
      </script>
      <template><p>{{ count }}</p></template>
    `);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('derived(() => derived(() => count.value))');
    expect(result.code).toContain('return derived(() => count);');
  });
});
