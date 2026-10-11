import { sxVue } from './plugin';

describe('Streamix Vue Vite plugin', () => {
  it('transforms authored SFCs before Vue handles them', () => {
    const plugin = sxVue();
    const transformed = transformOf(plugin).call(
      context(),
      `
        <script setup lang="ts">
        import { atom } from '@epikodelabs/streamix';
        const count = atom(0);
        </script>
        <template><button @click="count++">{{ count }}</button></template>
      `,
      '/workspace/src/Counter.vue',
    ) as { code: string; map: null };

    expect(transformed.map).toBeNull();
    expect(transformed.code).toContain('const count = atom(0);');
    expect(transformed.code).toContain('useWritable(count)');
    expect(transformed.code).toContain('@epikodelabs/streamix/vue');
  });

  it('skips irrelevant files and honors the include filter', () => {
    const plugin = sxVue({ include: id => id.endsWith('Included.vue') });
    const transform = transformOf(plugin);

    expect(transform.call(context(), '<template />', '/workspace/src/Plain.vue')).toBeNull();
    expect(transform.call(context(), '<template />', '/workspace/node_modules/lib/Item.vue')).toBeNull();
    expect(transform.call(context(), '<template />', '/workspace/src/Skipped.vue')).toBeNull();
  });

  it('recognizes script setup regardless of attribute order', () => {
    const transformed = transformOf(sxVue()).call(
      context(),
      `<script lang="ts" setup>import { atom } from '@epikodelabs/streamix'; const count = atom(0);</script><template>{{ count }}</template>`,
      '/workspace/src/Counter.vue',
    ) as { code: string };

    expect(transformed.code).toContain('useWritable(count)');
  });

  it('turns compiler errors into Vite errors with source locations', () => {
    const plugin = sxVue();

    expect(() => transformOf(plugin).call(
      context(),
      `
        <script setup>
        import { scope } from '@epikodelabs/streamix';
        const state = scope({ title: 'Ready' });
        </script>
        <template><x-editor v-model="state.title" /></template>
      `,
      '/workspace/src/Editor.vue',
    )).toThrowError(/Editor\.vue:\d+:\d+/);
  });
});

function context(): { warn: (message: string) => void; error: (message: string) => never } {
  return {
    warn: () => undefined,
    error: (message: string): never => { throw new Error(message); },
  };
}

function transformOf(plugin: ReturnType<typeof sxVue>): (source: string, id: string) => unknown {
  const transform = plugin.transform!;
  return (typeof transform === 'function' ? transform : transform.handler) as (source: string, id: string) => unknown;
}
