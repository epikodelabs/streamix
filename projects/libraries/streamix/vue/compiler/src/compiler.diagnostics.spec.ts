import { formatVueSfcDiagnostics, transformVueSfc } from './compiler';

const SCOPE_SCRIPT = `
  <script setup lang="ts">
  import { scope } from '@epikodelabs/streamix';
  const state = scope({ title: '' });
  </script>
`;

describe('Vue SFC compiler v-model native-attribute checks', () => {
  it('ignores bound type attributes', () => {
    const result = transformVueSfc(`${SCOPE_SCRIPT}
      <template><input :type="inputType" v-model="state.title"></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(':value="');
    expect(result.code).toContain('@input="state.set(');
  });

  it('ignores data-type attributes', () => {
    const result = transformVueSfc(`${SCOPE_SCRIPT}
      <template><input data-type="number" v-model="state.title"></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('@input="state.set(');
  });

  it('ignores a type= substring inside another attribute value', () => {
    const result = transformVueSfc(`${SCOPE_SCRIPT}
      <template><input title="type=number" v-model="state.title"></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('@input="state.set(');
  });

  it('still rejects non-text static input types', () => {
    const result = transformVueSfc(`${SCOPE_SCRIPT}
      <template><input type="checkbox" v-model="state.title"></template>
    `);

    expect(result.diagnostics.some(item =>
      item.message.includes('cannot be compiled'),
    )).toBeTrue();
  });

  it('ignores a bound multiple attribute but rejects a static one', () => {
    const allowed = transformVueSfc(`${SCOPE_SCRIPT}
      <template><select :multiple="isMultiple" v-model="state.title"></select></template>
    `);
    expect(allowed.diagnostics).toEqual([]);
    expect(allowed.code).toContain('@change="state.set(');

    const rejected = transformVueSfc(`${SCOPE_SCRIPT}
      <template><select multiple v-model="state.title"></select></template>
    `);
    expect(rejected.diagnostics.some(item =>
      item.message.includes('cannot be compiled'),
    )).toBeTrue();
  });
});

describe('Vue SFC compiler diagnostic positions', () => {
  it('positions SFC parse errors from the Vue AST', () => {
    const source = '<template><div></template>';
    const result = transformVueSfc(source, 'Bad.vue');

    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].start).toBe(source.indexOf('<div>'));
    expect(formatVueSfcDiagnostics(source, 'Bad.vue', result.diagnostics))
      .toContain('Bad.vue:1:11');
  });

  it('points an unknown scope member at the offending expression', () => {
    const source = `${SCOPE_SCRIPT}
      <template><p>{{ state.missing }}</p></template>
    `;
    const result = transformVueSfc(source);
    const diagnostic = result.diagnostics.find(item => item.message.includes('state.missing'))!;

    expect(diagnostic).toBeDefined();
    expect(diagnostic.start).toBe(source.indexOf('state.missing'));
    expect(diagnostic.length).toBe('state.missing'.length);
  });

  it('points an unsupported scope write at the assignment', () => {
    const source = `
      <script setup lang="ts">
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ profile: { name: '' } });
      </script>
      <template><button @click="state.profile = 'none'">Reset</button></template>
    `;
    const result = transformVueSfc(source);
    const diagnostic = result.diagnostics.find(item =>
      item.message.includes('nested scope'),
    )!;

    expect(diagnostic).toBeDefined();
    expect(diagnostic.start).toBe(source.indexOf('state.profile ='));
  });
});

describe('Vue SFC compiler v-model attribute overlaps', () => {
  it('rejects an authored @input alongside scope v-model', () => {
    const result = transformVueSfc(`${SCOPE_SCRIPT}
      <template><input v-model="state.title" @input="onInput"></template>
    `);
    const diagnostic = result.diagnostics.find(item =>
      item.message.includes('cannot be combined') && item.message.includes('@input'),
    );

    expect(diagnostic).toBeDefined();
    expect((result.code.match(/@input/g) ?? []).length).toBe(1);
    expect(result.code).not.toContain('state.set(');
  });

  it('rejects an authored @change alongside a select scope v-model', () => {
    const result = transformVueSfc(`${SCOPE_SCRIPT}
      <template><select v-model="state.title" @change="onChange"></select></template>
    `);
    expect(result.diagnostics.some(item =>
      item.message.includes('cannot be combined') && item.message.includes('@change'),
    )).toBeTrue();
  });

  it('rejects an authored :value alongside scope v-model', () => {
    const result = transformVueSfc(`${SCOPE_SCRIPT}
      <template><input :value="title" v-model="state.title"></template>
    `);
    expect(result.diagnostics.some(item =>
      item.message.includes('cannot be combined') && item.message.includes(':value'),
    )).toBeTrue();
    expect((result.code.match(/:value=/g) ?? []).length).toBe(1);
  });

  it('rejects v-bind:value and v-on:input variants too', () => {
    const result = transformVueSfc(`${SCOPE_SCRIPT}
      <template><input v-bind:value="title" v-on:input="onInput" v-model="state.title"></template>
    `);
    expect(result.diagnostics.some(item =>
      item.message.includes('cannot be combined') && item.message.includes(':value'),
    )).toBeTrue();
  });

  it('still lowers v-model when no conflicting attribute is authored', () => {
    const result = transformVueSfc(`${SCOPE_SCRIPT}
      <template><input v-model="state.title" class="field"></template>
    `);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('@input="state.set(\'title\', $event.target.value)"');
  });
});

describe('Vue SFC compiler async derived formulas', () => {
  const sourceOf = (script: string) =>
    `<script setup lang="ts">\n${script}\n</script>\n<template><p>ready</p></template>`;
  const isAsyncFormula = (message: string): boolean =>
    message.includes('derived()') && message.includes('synchronously');

  it('rejects an async arrow formula with a positioned diagnostic', () => {
    const script = `
      import { atom, derived } from '@epikodelabs/streamix';
      const source = atom(1);
      const doubled = derived(async () => source * 2);
    `;
    const source = sourceOf(script);
    const result = transformVueSfc(source);
    const diagnostic = result.diagnostics.find(item => isAsyncFormula(item.message));

    expect(diagnostic).toBeDefined();
    expect(diagnostic!.start).toBe(source.indexOf('async () => source * 2'));
    expect(diagnostic!.length).toBe('async () => source * 2'.length);
    expect(formatVueSfcDiagnostics(source, 'Async.vue', [diagnostic!]))
      .toContain('Async.vue:');
  });

  it('rejects async function expressions and async generators', () => {
    const functionResult = transformVueSfc(sourceOf(`
      import { atom, derived } from '@epikodelabs/streamix';
      const source = atom(1);
      const value = derived(async function () { return source; });
    `));
    expect(functionResult.diagnostics.some(item => isAsyncFormula(item.message))).toBeTrue();

    const generatorResult = transformVueSfc(sourceOf(`
      import { atom, derived } from '@epikodelabs/streamix';
      const source = atom(1);
      const value = derived(async function* () { yield source; return source; });
    `));
    expect(generatorResult.diagnostics.some(item => isAsyncFormula(item.message))).toBeTrue();
  });

  it('keeps synchronous and generator formulas supported', () => {
    const sync = transformVueSfc(sourceOf(`
      import { atom, derived, flow } from '@epikodelabs/streamix';
      const source = atom(1);
      const doubled = derived(() => source * 2);
      const generated = derived(function* () { yield source; return source; });
      const updates = flow(async function* () { yield 1; });
    `));
    expect(sync.diagnostics).toEqual([]);
    expect(sync.code).toContain('derived(() => source.value * 2)');
  });
});
