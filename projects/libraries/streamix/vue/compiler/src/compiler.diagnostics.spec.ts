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
