import { transformVueSfc } from './compiler';

describe('Vue SFC compiler generated imports', () => {
  it('rejects a local helper named like a generated composable', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { atom } from '@epikodelabs/streamix';
      function useWritable() { return 'local'; }
      const count = atom(0);
      </script>
      <template>{{ count }}</template>
    `);

    expect(result.diagnostics.some(item =>
      item.message.includes('useWritable') && item.message.includes('collides'),
    )).toBeTrue();
  });

  it('rejects a non-bridge import named like a generated composable', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { useWritable } from './utils';
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      </script>
      <template>{{ count }}</template>
    `);

    expect(result.diagnostics.some(item =>
      item.message.includes('useWritable') && item.message.includes('collides'),
    )).toBeTrue();
  });

  it('keeps an aliased runtime import and adds the canonical value import', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { useWritable as uw } from '@epikodelabs/streamix/vue';
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      </script>
      <template>{{ count }}</template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('useWritable as uw');
    expect(result.code).toContain('import { useWritable } from "@epikodelabs/streamix/vue";');
  });

  it('reuses an unaliased value import from the bridge module', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { useWritable } from '@epikodelabs/streamix/vue';
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      </script>
      <template>{{ count }}</template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/import \{[^}]*useWritable[^}]*\} from/g)?.length).toBe(1);
  });

  it('treats a whole type-only import as a collision, not a value import', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import type { useWritable } from '@epikodelabs/streamix/vue';
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      </script>
      <template>{{ count }}</template>
    `);

    expect(result.diagnostics.some(item =>
      item.message.includes('useWritable') && item.message.includes('collides'),
    )).toBeTrue();
    // The generated value import is not suppressed by the type-only import.
    expect(result.code).toContain('import { useWritable } from "@epikodelabs/streamix/vue";');
  });

  it('treats a type-only specifier as a collision, not a value import', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { type useWritable } from '@epikodelabs/streamix/vue';
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      </script>
      <template>{{ count }}</template>
    `);

    expect(result.diagnostics.some(item =>
      item.message.includes('useWritable') && item.message.includes('collides'),
    )).toBeTrue();
    expect(result.code).toContain('import { useWritable } from "@epikodelabs/streamix/vue";');
  });
});
