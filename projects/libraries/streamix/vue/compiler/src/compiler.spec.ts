import { transformVueSfc } from './compiler';

describe('Vue SFC compiler', () => {
  it('adopts atom, derived, and flow declarations in script setup', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { atom, derived, flow } from '@epikodelabs/streamix';
      const count = atom(0);
      const factor = atom(2);
      const doubled = derived(() => count * factor);
      const updates = flow(async function* () { yield 1; });
      </script>
      <template><button @click="count++">{{ count }} {{ doubled }} {{ updates }}</button></template>
    `);

    expect(result.bindingCount).toBe(4);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      'import { useIterable, useWritable } from "@epikodelabs/streamix/vue";',
    );
    expect(result.code).toContain('const count = atom(0);');
    expect(result.code).toContain('const __sx_count = useWritable(count);');
    expect(result.code).toContain('const factor = atom(2);');
    expect(result.code).toContain('const __sx_factor = useWritable(factor);');
    expect(result.code).toContain('const doubled = derived(() => count.value * factor.value);');
    expect(result.code).toContain('const __sx_doubled = useIterable(doubled);');
    expect(result.code).toContain('const updates = flow(async function* () { yield 1; });');
    expect(result.code).toContain('const __sx_updates = useIterable(updates);');
    expect(result.code).toContain('{{ __sx_count }} {{ __sx_doubled }} {{ __sx_updates }}');
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

    expect(result.bindingCount).toBe(3);
    expect(result.bridgedScopes).toEqual({ state: ['count', 'title'] });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('const state = useScope(() => scope({ title: \'Ready\', count: 0 }));');
    expect(result.code).toContain(
      'import { useIterable, useScope } from "@epikodelabs/streamix/vue";',
    );
    expect(result.code).toContain("useIterable(state.get('count'));");
    expect(result.code).toContain("useIterable(state.get('title'));");
    expect(result.code).toContain(':value="__sx_000073000074000061000074000065_00007400006900007400006c000065"');
    expect(result.code).toContain('@click="state.set(\'count\', __sx_000073000074000061000074000065_00006300006f00007500006e000074 + 1)"');
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

    expect(result.bindingCount).toBe(3);
    expect(result.bridgedScopes).toEqual({ state: ['rows', 'visible'] });
    expect(result.code).toContain('const state = useScope(() => scope({ visible: true, rows: [] }));');
    expect(result.code).toContain('v-if="__sx_000073000074000061000074000065_00007600006900007300006900006200006c000065"');
    expect(result.code).toContain('v-for="row in __sx_000073000074000061000074000065_00007200006f000077000073"');
  });

  it('wraps a scope the template never touches so its lifetime stays component-owned', () => {
    const result = transformVueSfc(`
      <script setup>
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ total: 0 });
      setInterval(() => state.set('total', 1));
      </script>
      <template><p>Static</p></template>
    `);

    expect(result.bindingCount).toBe(1);
    expect(result.bridgedScopes).toEqual({});
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('const state = useScope(() => scope({ total: 0 }));');
    expect(result.code).toContain('import { useScope } from "@epikodelabs/streamix/vue";');
    expect(result.code).toContain('<p>Static</p>');
  });

  it('reports unknown scope bindings instead of guessing', () => {
    const result = transformVueSfc(`
      <script setup>
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ title: 'Ready' });
      </script>
      <template><x-editor v-model="state.missing" /></template>
    `);

    expect(result.bindingCount).toBe(1);
    expect(result.bridgedScopes).toEqual({ state: [] });
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].message).toContain('state.missing');
  });
});
