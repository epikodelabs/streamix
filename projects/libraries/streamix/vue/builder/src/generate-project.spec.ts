import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateVueProject, virtualRootOf } from './generate-project';

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
      expect(counter).toContain('useWritable(atom(0))');
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
