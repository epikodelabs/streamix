import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { generateVueProject, regenerateVueFile, virtualRootOf } from './generate-project';

/** Content snapshot of every file under a tree, keyed by slash-relative path. */
async function snapshotTree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files[relative(root, path).replace(/\\/g, '/')] = await readFile(path, 'utf8');
    }
  };
  await walk(root);
  return files;
}

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
      // The compiler's authored-position map is written beside the SFC; the
      // vite delegate chains it so devtools point at authored files.
      const map = JSON.parse(await readFile(join(output, 'Counter.vue.map'), 'utf8'));
      expect(map.version).toBe(3);
      expect(map.sources).toEqual(['projects/apps/demo/src/Counter.vue']);
      expect(map.sourcesContent[0]).toContain('const count = atom(0);');
      expect(await readFile(join(output, 'plain.txt'), 'utf8')).toBe('copied unchanged');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('uses the same virtual-root convention as the other framework builders', () => {
    expect(virtualRootOf('projects/apps/demo/src')).toBe('demo/src');
    expect(virtualRootOf('projects/apps/demo/client')).toBe('demo/client');
  });

  it('mirrors authored deletions by removing the generated SFC and its map', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-builder-delete-'));
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
      await writeFile(join(source, 'Extra.vue'), `
        <script setup lang="ts">
        import { atom } from '@epikodelabs/streamix';
        const keep = atom(1);
        </script>
        <template><span>{{ keep }}</span></template>
      `);

      const output = await generateVueProject(workspace, sourceRoot);
      const virtualExtra = join(output, 'Extra.vue');
      await readFile(virtualExtra, 'utf8');

      // Deleting the authored SFC removes its virtual twin and map, so the
      // delegated build never resolves a stale component.
      await rm(join(source, 'Extra.vue'));
      await regenerateVueFile(workspace, sourceRoot, 'Extra.vue');
      await expectAsync(readFile(virtualExtra, 'utf8')).toBeRejected();
      await expectAsync(readFile(`${virtualExtra}.map`, 'utf8')).toBeRejected();

      // Siblings stay untouched.
      expect(await readFile(join(output, 'Counter.vue'), 'utf8')).toContain("useWritable(count, 'count')");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('Vue builder production safety', () => {
  it('rejects absolute and traversing source roots before modifying generated files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-root-'));
    try {
      for (const invalid of ['', '.', '..', '../outside', '/tmp/source', 'C:\\source', '.angular/source', 'node_modules/x']) {
        await expectAsync(generateVueProject(workspace, invalid)).toBeRejectedWithError(/sourceRoot/);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('reports the same authored path for full and watch compilation errors', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-diagnostic-path-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const source = join(workspace, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(source, 'Broken.vue'), `<script setup>import { scope } from '@epikodelabs/streamix'; const state = scope({ name: '' });</script><template><x-control v-model="state.name"/></template>`);

      const capture = (promise: Promise<unknown>): Promise<Error> =>
        promise.then(() => { throw new Error('Expected regeneration to fail'); }, error => error as Error);
      const fullError = await capture(generateVueProject(workspace, sourceRoot));
      const watchError = await capture(regenerateVueFile(workspace, sourceRoot, 'Broken.vue'));

      const authored = `${relative(workspace, join(source, 'Broken.vue'))}:`;
      expect(fullError.message.startsWith(authored)).toBeTrue();
      expect(watchError.message.startsWith(authored)).toBeTrue();
      expect(watchError.message).toBe(fullError.message);
      expect(fullError.message).not.toContain('.angular/.streamix');
      expect(fullError.message).not.toContain(workspace);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it('reports every failing SFC in one failure', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { join, relative } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateVueProject } = await import('./generate-project');
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-aggregate-'));
    const sourceRoot = 'projects/apps/demo/src';
    const broken = `<script setup>import { scope } from '@epikodelabs/streamix'; const state = scope({ name: '' });</script><template><x-control v-model="state.name"/></template>`;
    try {
      const source = join(workspace, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(source, 'One.vue'), broken);
      await writeFile(join(source, 'Two.vue'), broken);
      const error = await generateVueProject(workspace, sourceRoot)
        .then(() => { throw new Error('Expected generation to fail'); }, (reason: unknown) => reason as Error);
      expect(error.message).toContain(`${relative(workspace, join(source, 'One.vue'))}:`);
      expect(error.message).toContain(`${relative(workspace, join(source, 'Two.vue'))}:`);
      expect((error.message.match(/v-model on <x-control>/g) ?? []).length).toBe(2);
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
      await generateVueProject(workspace, sourceRoot);
      const before = await snapshotTree(join(workspace, '.angular'));
      await writeFile(join(source, 'Broken.vue'), `<script setup>import { scope } from '@epikodelabs/streamix'; const state = scope({ name: '' });</script><template><x-control v-model="state.name"/></template>`);
      await expectAsync(generateVueProject(workspace, sourceRoot)).toBeRejectedWithError(/v-model on <x-control>/);
      // The failed pass must not touch one byte of the served virtual tree.
      expect(await snapshotTree(join(workspace, '.angular'))).toEqual(before);
      const siblings = await readdir(join(workspace, '.angular/.streamix/demo'));
      expect(siblings.filter(name => name.includes('sx-stage') || name.includes('sx-backup'))).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('recovers a tree abandoned by a crashed generation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-crash-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const source = join(workspace, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(source, 'Counter.vue'), `<script setup>import { atom } from '@epikodelabs/streamix'; const count = atom(1);</script><template>{{ count }}</template>`);
      await generateVueProject(workspace, sourceRoot);
      const before = await snapshotTree(join(workspace, '.angular'));
      // Simulate a crash between the backup and install renames: the live
      // tree is missing, the last good generation sits in an orphaned backup,
      // and a failed stage lingers beside it.
      const appDir = join(workspace, '.angular/.streamix/demo');
      await rename(join(appDir, 'src'), join(appDir, '.src-sx-backup-11111111-2222-3333-4444-555555555555'));
      await mkdir(join(appDir, '.src-sx-stage-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), { recursive: true });
      await writeFile(join(source, 'Broken.vue'), `<script setup>import { scope } from '@epikodelabs/streamix'; const state = scope({ name: '' });</script><template><x-control v-model="state.name"/></template>`);
      await expectAsync(generateVueProject(workspace, sourceRoot)).toBeRejectedWithError(/v-model on <x-control>/);
      // The sweep restored the backup into the live tree and cleaned the
      // abandoned stage before the failing pass ran.
      expect(await snapshotTree(join(workspace, '.angular'))).toEqual(before);
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
      expect(generated).toContain('introspection/activate');
      expect(generated).toContain('__sxMount();');
      expect(generated.indexOf('introspection/activate')).toBeLessThan(generated.indexOf('createApp'));
      // Authored source stays clean: injection lives only in the generated tree.
      expect(await readFile(join(source, 'main.ts'), 'utf8')).toBe(authored);

      // A watch edit of the entry must keep the activation.
      await regenerateVueFile(workspace, sourceRoot, 'main.ts', true);
      expect(await readFile(generatedPath, 'utf8')).toContain('introspection/activate');
      // Dropping the flag regenerates without it.
      await generateVueProject(workspace, sourceRoot, false);
      expect(await readFile(join(virtualRoot, 'main.ts'), 'utf8')).not.toContain('introspection/activate');
      await regenerateVueFile(workspace, sourceRoot, 'main.ts', false);
      expect(await readFile(generatedPath, 'utf8')).not.toContain('introspection/activate');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('instruments an SFC without Streamix sources when the app tsconfig has no roots', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamix-vue-builder-plain-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const source = join(workspace, sourceRoot);
      await mkdir(source, { recursive: true });
      await writeFile(join(workspace, 'projects/apps/demo/tsconfig.json'), JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.app.json' }],
      }));
      await writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' },
        include: ['projects/apps/demo/src/**/*.ts', 'projects/apps/demo/src/**/*.vue'],
      }));
      await writeFile(join(source, 'main.ts'), `import { createApp } from 'vue';\ncreateApp({}).mount('#app');\n`);
      await writeFile(join(source, 'Plain.vue'), `
        <script setup lang="ts">
        const local = 1;
        </script>
        <template><span>{{ local }}</span></template>
      `);
      const output = await generateVueProject(workspace, sourceRoot, true);
      expect(await readFile(join(output, 'main.ts'), 'utf8')).toContain('introspection/activate');
      expect(await readFile(join(output, 'Plain.vue'), 'utf8')).not.toContain('__sxDebug');
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
      expect(await readFile(join(output, 'src', 'main.ts'), 'utf8')).toContain('introspection/activate');
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
