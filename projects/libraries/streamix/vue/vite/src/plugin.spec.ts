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
    ) as { code: string; map: { version: number; mappings: string; sourcesContent: string[] } };

    expect(transformed.map.version).toBe(3);
    expect(transformed.map.mappings.length).toBeGreaterThan(0);
    expect(transformed.map.sourcesContent[0]).toContain('const count = atom(0)');
    expect(transformed.code).toContain('const count = atom(0);');
    expect(transformed.code).toContain("useWritable(count, 'count')");
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

    expect(transformed.code).toContain("useWritable(count, 'count')");
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

  it('builds with the inspector when introspection is on and completely without otherwise', () => {
    const sfc = `<script setup lang="ts">import { atom } from '@epikodelabs/streamix'; const count = atom(0);</script><template><button @click="count++">{{ count }}</button></template>`;
    const entry = `import { createApp } from 'vue';\ncreateApp({}).mount('#app');\n`;

    const on = sxVue({ introspection: true });
    const define = (on.config as any)?.call(on, {}, { command: 'build' });
    expect(define.define['import.meta.env.DEV']).toBe('true');
    const transform = transformOf(on);
    const enabledSfc = transform.call(context(), sfc, '/workspace/src/Counter.vue') as { code: string };
    expect(enabledSfc.code).toContain('__sxDebug(atom(0)');
    expect(enabledSfc.code).toContain("useWritable(count, 'count')");
    const enabledEntry = transform.call(context(), entry, '/workspace/src/main.ts') as { code: string };
    expect(enabledEntry.code).toContain('__sxEnable();');
    expect(enabledEntry.code).toContain('__sxMount();');

    const off = transformOf(sxVue());
    const offSfc = off.call(context(), sfc, '/workspace/src/Counter.vue') as { code: string };
    expect(offSfc.code).not.toContain('__sxDebug');
    expect(off.call(context(), entry, '/workspace/src/main.ts')).toBeNull();
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
