import { transformVueSfc } from './compiler';

describe('Vue SFC compiler', () => {
  it('adopts atom, derived, and flow declarations in script setup', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { atom, derived, flow } from '@epikodelabs/streamix';
      const count = atom(0);
      const doubled = derived(() => count.value * 2);
      const updates = flow(async function* () { yield 1; });
      </script>
      <template><button @click="count++">{{ count }} {{ doubled }} {{ updates }}</button></template>
    `);

    expect(result.bindingCount).toBe(3);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      'import { useIterable, useWritable } from "@epikodelabs/streamix/vue";',
    );
    expect(result.code).toContain('const count = useWritable(atom(0));');
    expect(result.code).toContain('const doubled = useIterable(derived(() => count.value * 2));');
    expect(result.code).toContain('const updates = useIterable(flow(async function* () { yield 1; }));');
  });

  it('bridges scope reads, writes, and native v-model bindings', () => {
    const result = transformVueSfc(`
      <script setup>
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ title: 'Ready', count: 0 });
      </script>
      <template>
        <input v-model="state.title">
        <button @click="state.count = state.count + 1">{{ state.count }}</button>
      </template>
    `);

    expect(result.bindingCount).toBe(2);
    expect(result.bridgedScopes).toEqual({ state: ['count', 'title'] });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("const __sx_state_count = useIterable(state.get('count'));" );
    expect(result.code).toContain("const __sx_state_title = useIterable(state.get('title'));" );
    expect(result.code).toContain(':value="__sx_state_title" @input="state.set(\'title\', $event.target.value)"');
    expect(result.code).toContain('@click="state.set(\'count\', __sx_state_count + 1)"');
    expect(result.code).toContain('{{ __sx_state_count }}');
  });

  it('bridges scope members used exclusively in Vue directives', () => {
    const result = transformVueSfc(`
      <script setup>
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ visible: true, rows: [] });
      </script>
      <template>
        <p v-if="state.visible">Visible</p>
        <span v-for="row in state.rows" :key="row.id">{{ row.name }}</span>
      </template>
    `);

    expect(result.bindingCount).toBe(2);
    expect(result.bridgedScopes).toEqual({ state: ['rows', 'visible'] });
    expect(result.code).toContain('v-if="__sx_state_visible"');
    expect(result.code).toContain('v-for="row in __sx_state_rows"');
  });

  it('reports unknown scope bindings instead of guessing', () => {
    const result = transformVueSfc(`
      <script setup>
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ title: 'Ready' });
      </script>
      <template><x-editor v-model="state.missing" /></template>
    `);

    expect(result.bindingCount).toBe(0);
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].message).toContain('state.missing');
  });
});
