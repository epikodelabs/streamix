import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
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
    expect(enabledEntry.code).toContain("import '@epikodelabs/streamix/introspection/activate';");
    expect(enabledEntry.code).toContain('__sxMount();');

    const off = transformOf(sxVue());
    const offSfc = off.call(context(), sfc, '/workspace/src/Counter.vue') as { code: string };
    expect(offSfc.code).not.toContain('__sxDebug');
    expect(off.call(context(), entry, '/workspace/src/main.ts')).toBeNull();
  });

  it('reuses cached programs and invalidates only the project containing the edit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'streamix-vue-vite-watch-'));
    try {
      const projectA = join(root, 'a');
      const projectB = join(root, 'b');
      await mkdir(projectA, { recursive: true });
      await mkdir(projectB, { recursive: true });
      const config = JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' },
        include: ['*.ts'],
      });
      await writeFile(join(projectA, 'tsconfig.json'), config);
      await writeFile(join(projectB, 'tsconfig.json'), config);
      const fileA = join(projectA, 'a.ts');
      const fileB = join(projectB, 'b.ts');
      const originalA = `import { atom } from '@epikodelabs/streamix';\nexport const count = atom(0);`;
      const sourceB = `import { atom } from '@epikodelabs/streamix';\nexport const title = atom('b');`;
      await writeFile(fileA, originalA);
      await writeFile(fileB, sourceB);

      const plugin = sxVue({ introspection: true });
      const transform = (source: string, path: string) =>
        transformOf(plugin).call(context(), source, path) as { code: string };
      const watchChange = watchChangeOf(plugin);

      transform(originalA, fileA);
      transform(sourceB, fileB);

      const readFileSpy = spyOn(ts.sys, 'readFile').and.callThrough();
      const editedA = `import { atom } from '@epikodelabs/streamix';\nexport const count = atom(1);`;
      await writeFile(fileA, editedA);
      watchChange(fileA, { event: 'update' });

      readFileSpy.calls.reset();
      const rebuilt = transform(editedA, fileA); // A rebuilds: config plus source reads
      const rebuildReads = readFileSpy.calls.count();

      readFileSpy.calls.reset();
      transform(sourceB, fileB); // B stays cached: only its config is read
      const cachedReads = readFileSpy.calls.count();
      readFileSpy.and.callThrough();

      expect(rebuilt.code).toContain('__sxDebug(atom(1)');
      expect(rebuildReads).toBeGreaterThan(1);
      expect(cachedReads).toBe(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);

  it('drops a cached SFC program when the authored SFC changes on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'streamix-vue-vite-sfc-'));
    try {
      const app = join(root, 'app');
      await mkdir(app, { recursive: true });
      await writeFile(join(app, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' },
        include: ['*.ts', '*.vue'],
      }));
      const sfcPath = join(app, 'Counter.vue');
      const sfcSource = `<script setup lang="ts">import { atom } from '@epikodelabs/streamix'; const count = atom(0);</script><template><button @click="count++">{{ count }}</button></template>`;
      await writeFile(sfcPath, sfcSource);

      const plugin = sxVue({ introspection: true });
      const transform = (source: string, path: string) =>
        transformOf(plugin).call(context(), source, path) as { code: string };
      const watchChange = watchChangeOf(plugin);

      const instrumented = transform(sfcSource, sfcPath) as { code: string };
      expect(instrumented.code).toContain('__sxDebug(atom(0)');

      // The semantic program holds the virtual `Counter.vue.ts` overlay, never
      // the authored SFC file, so the SFC's own watch event must drop it —
      // the in-memory script text alone cannot prove staleness here.
      watchChange(sfcPath, { event: 'update' });

      const readFileSpy = spyOn(ts.sys, 'readFile').and.callThrough();
      transform(sfcSource, sfcPath);
      readFileSpy.and.callThrough();

      expect(readFileSpy.calls.count()).toBeGreaterThan(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);
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

function watchChangeOf(plugin: ReturnType<typeof sxVue>): (id: string, change: { event: 'create' | 'update' | 'delete' }) => unknown {
  const watchChange = plugin.watchChange!;
  return (typeof watchChange === 'function' ? watchChange : watchChange.handler) as
    (id: string, change: { event: 'create' | 'update' | 'delete' }) => unknown;
}
