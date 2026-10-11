import ts from 'typescript';
import { transformVueSfc } from './compiler';

const compile = (script: string, template: string) =>
  transformVueSfc(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`);

function expectNoError(result: ReturnType<typeof compile>): void {
  expect(result.diagnostics.filter(item => item.category === 'error')).toEqual([]);
}

describe('Vue compiler correctness regressions', () => {
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
    expect(result.bindingCount).toBe(0);
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
    expect(result.code).toContain('import { useIterable } from');
    expect(result.code).not.toContain('import { useIterable, useWritable }');
  });

  it('produces parseable script edits after rewriting', () => {
    const result = compile(`
      import { atom, derived } from '@epikodelabs/streamix';
      const count = atom(1);
      const squared = derived(() => ({ count, value: count * count }));
    `, '{{ squared }}');
    expectNoError(result);
    const body = /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(result.code)![1];
    const file = ts.createSourceFile('result.ts', body, ts.ScriptTarget.Latest, true);
    expect(file.parseDiagnostics).toEqual([]);
  });

  it('bridges a scope member used only by v-model', () => {
    const result = compile(`
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ title: '' });
    `, '<input v-model="state.title">');
    expectNoError(result);
    expect(result.bindingCount).toBe(1);
    expect(result.bridgedScopes).toEqual({ state: ['title'] });
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

});
