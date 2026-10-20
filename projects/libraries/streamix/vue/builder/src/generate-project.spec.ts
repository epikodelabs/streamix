import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateVueProject, regenerateVueFile, virtualRootOf } from './generate-project';

describe('Vue builder project generation', () => {
  it('copies and transforms Vue SFCs into the delegated virtual project', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-builder-'));
    const sourceRoot = 'projects/apps/demo/src';
    const source = join(workspace, sourceRoot);

    try {
      await mkdir(source, { recursive: true });
      await writeFile(join(source, 'Counter.vue'), `
        <script setup lang="ts">
        import { atom } from '@epikodelabs/streamix';
        const count = atom(0);
        </script>
        <template><button @click="count++">{{ count }}</button></template>
      `);
      await writeFile(join(source, 'plain.txt'), 'copied unchanged');

      const output = await generateVueProject(workspace, sourceRoot);
      const counter = await readFile(join(output, 'Counter.vue'), 'utf8');

      expect(output).toBe(join(workspace, '.angular', '.streamix', 'demo/src'));
      expect(counter).toContain('const count = atom(0);');
      expect(counter).toContain("useWritable(count, 'count')");
      expect(await readFile(join(output, 'plain.txt'), 'utf8')).toBe('copied unchanged');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('uses the same virtual-root convention as the other framework builders', () => {
    expect(virtualRootOf('projects/apps/demo/src')).toBe('demo/src');
    expect(virtualRootOf('projects/apps/demo/client')).toBe('demo/client');
  });
});

describe('Vue builder production safety', () => {
  it('rejects absolute and traversing source roots before modifying generated files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-root-'));
    try {
      for (const invalid of ['', '.', '..', '../outside', '/tmp/source', 'C:\\source', '.angular/source']) {
        await expectAsync(generateVueProject(workspace, invalid)).toBeRejectedWithError(/sourceRoot/);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('preserves previously generated project when a later SFC fails compilation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-rollback-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const source = join(workspace, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(source, 'Counter.vue'), `<script setup>import { atom } from '@epikodelabs/streamix'; const count = atom(1);</script><template>{{ count }}</template>`);
      const output = await generateVueProject(workspace, sourceRoot);
      const before = await readFile(join(output, 'Counter.vue'), 'utf8');
      await writeFile(join(source, 'Broken.vue'), `<script setup>import { scope } from '@epikodelabs/streamix'; const state = scope({ name: '' });</script><template><x-control v-model="state.name"/></template>`);
      await expectAsync(generateVueProject(workspace, sourceRoot)).toBeRejectedWithError(/v-model on <x-control>/);
      expect(await readFile(join(output, 'Counter.vue'), 'utf8')).toBe(before);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('Vue builder introspection injection', () => {
  it('injects introspection activation into the generated entry only when enabled', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-builder-introspect-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const source = join(workspace, sourceRoot);
      await mkdir(source, { recursive: true });
      const authored = `import { createApp } from 'vue';\ncreateApp({}).mount('#app');\n`;
      await writeFile(join(source, 'main.ts'), authored);
      const generatedPath = join(workspace, '.angular', '.streamix', 'demo/src', 'main.ts');

      const virtualRoot = await generateVueProject(workspace, sourceRoot, true);
      const generated = await readFile(generatedPath, 'utf8');
      expect(generated).toContain('__sxEnable();');
      expect(generated).toContain('__sxMount();');
      expect(generated.indexOf('__sxEnable();')).toBeLessThan(generated.indexOf('createApp'));
      // Authored source stays clean: injection lives only in the generated tree.
      expect(await readFile(join(source, 'main.ts'), 'utf8')).toBe(authored);

      // A watch edit of the entry must keep the activation.
      await regenerateVueFile(workspace, sourceRoot, 'main.ts', true);
      expect(await readFile(generatedPath, 'utf8')).toContain('__sxEnable();');
      // Dropping the flag regenerates without it.
      await generateVueProject(workspace, sourceRoot, false);
      expect(await readFile(join(virtualRoot, 'main.ts'), 'utf8')).not.toContain('__sxEnable');
      await regenerateVueFile(workspace, sourceRoot, 'main.ts', false);
      expect(await readFile(generatedPath, 'utf8')).not.toContain('__sxEnable');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('finds the bootstrap entry under src/ in the standard vite layout', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-builder-entry-'));
    const sourceRoot = 'projects/apps/demo';
    try {
      const source = join(workspace, sourceRoot);
      await mkdir(join(source, 'src'), { recursive: true });
      await writeFile(join(source, 'index.html'), '<div id="app"></div>');
      await writeFile(join(source, 'src', 'main.ts'), `createApp({}).mount('#app');\n`);
      const output = await generateVueProject(workspace, sourceRoot, true);
      expect(await readFile(join(output, 'src', 'main.ts'), 'utf8')).toContain('__sxEnable();');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('registers atoms from TS modules and SFC scripts while keeping adoption working', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-builder-register-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const source = join(workspace, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' },
        include: ['projects/apps/demo/src/**/*.ts'],
      }));
      await writeFile(join(source, 'store.ts'), `import { atom, derived } from '@epikodelabs/streamix';\nexport const count = atom(0);\nexport const doubled = derived(() => count * 2);\n`);
      await writeFile(join(source, 'Counter.vue'), `
        <script setup lang="ts">
        import { atom, scope } from '@epikodelabs/streamix';
        const clicks = atom(0);
        const state = scope({ tone: 'quiet' });
        </script>
        <template><button @click="clicks++">{{ clicks }} {{ state.tone }}</button></template>
      `);

      const output = await generateVueProject(workspace, sourceRoot, true);
      const store = await readFile(join(output, 'store.ts'), 'utf8');
      expect(store).toContain('__sxDebug(atom(0)');
      expect(store).toContain('__sxDebug(derived(');
      const counter = await readFile(join(output, 'Counter.vue'), 'utf8');
      expect(counter).toContain('__sxDebug(atom(0)');
      // The scope bridge lands inside the registration wrapper: the compiler
      // sees through __sxDebug, bridges the inner factory call, and the
      // wrapper ends up outermost with its scope members attached.
      expect(counter).toContain('__sxDebug(useScope(() => scope(');
      expect(counter).toContain('"kind":"scope"');
      expect(counter).toContain("useWritable(clicks, 'clicks')");

      // Without the flag: no registration wrappers anywhere.
      const plain = await generateVueProject(workspace, sourceRoot, false);
      expect(await readFile(join(plain, 'store.ts'), 'utf8')).not.toContain('__sxDebug');
      expect(await readFile(join(plain, 'Counter.vue'), 'utf8')).not.toContain('__sxDebug');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
