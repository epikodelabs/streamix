import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { sxVue } from './plugin';

describe('Streamix Vue Vite fixture', () => {
  it('builds authored SFCs through Streamix before the Vue plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'streamix-vite#fixture-'));
    try {
      const entry = join(root, 'src', 'main.ts');
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'Counter.vue'), `
        <script setup lang="ts">
        import { atom, derived } from '@epikodelabs/streamix';
        const price = atom(1);
        const total = derived(() => price * 2);
        const count = atom(0);
        </script>
        <template><button @click="count++">{{ count }} {{ total }}</button></template>
      `);
      await writeFile(entry, `
        import { createApp } from 'vue';
        import Counter from './Counter.vue';
        createApp(Counter).mount('#app');
      `);

      const output = await build({
        configFile: false,
        root,
        logLevel: 'silent',
        // Streamix runs before the Vue plugin (enforce: "pre") so the SFC the
        // Vue compiler sees is already bridged.
        plugins: [sxVue(), vue()],
        build: {
          write: false,
          // Assertions read the emitted code; keep external import names
          // intact regardless of the bundler's minifier.
          minify: false,
          rollupOptions: {
            input: entry,
            preserveEntrySignatures: 'strict',
            external: [
              'vue',
              '@epikodelabs/streamix',
              '@epikodelabs/streamix/vue',
            ],
          },
        },
      }) as { output: Array<{ type: string; code?: string }> };

      const code = output.output
        .filter(item => item.type === 'chunk')
        .map(item => item.code ?? '')
        .join('\n');
      expect(code).toContain('useWritable(count,');
      expect(code).toContain('@epikodelabs/streamix/vue');
      expect(code).toContain('price.value * 2');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 120_000);
});
