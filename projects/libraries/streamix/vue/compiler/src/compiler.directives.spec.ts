import { transformVueSfc } from './compiler';

function bridge(scope: string, path: string): string {
  const encode = (value: string): string =>
    [...value].map(char => char.codePointAt(0)!.toString(16).padStart(6, '0')).join('');
  return `__sx_${encode(scope)}_${encode(path)}`;
}

describe('Vue SFC compiler directive scanning', () => {
  it('scans v-memo expressions', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      </script>
      <template><p v-memo="[count]">{{ count }}</p></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('v-memo="[__sx_count]"');
  });

  it('scans argument-less custom directive expressions', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      </script>
      <template><div v-tooltip="count"></div></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('v-tooltip="__sx_count"');
  });

  it('scans custom directive arguments and modifiers with scope members', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { scope } from '@epikodelabs/streamix';
      const state = scope({ title: 'Ready' });
      </script>
      <template><div v-tooltip:top.foo="state.title"></div></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      `v-tooltip:top.foo="${bridge('state', 'title')}"`,
    );
  });

  it('expands same-name shorthand bindings for reactive bindings', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      const title = atom('Ready');
      </script>
      <template><Counter :count v-bind:title id="fixed" /></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(':count="__sx_count"');
    expect(result.code).toContain('v-bind:title="__sx_title"');
    expect(result.code).toContain('id="fixed"');
  });

  it('leaves same-name shorthand on plain state untouched', () => {
    const result = transformVueSfc(`
      <script setup lang="ts">
      import { atom } from '@epikodelabs/streamix';
      const count = atom(0);
      </script>
      <template><Counter :plain :count /></template>
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(':plain');
    expect(result.code).toContain(':count="__sx_count"');
  });
});
