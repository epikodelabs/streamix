import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { regenerateReactFile, regenerateReactFiles } from '../../../react/builder/src/generate-project';
import { regenerateVueFile, regenerateVueFiles } from './generate-project';
import { regenerateAngularFile, regenerateAngularFiles } from '../../../angular/builder/src/generate-project';
import * as reactWatch from '../../../react/builder/src/watch-libraries';
import * as vueWatch from './watch-libraries';
import * as angularWatch from '../../../angular/builder/src/watch-libraries';

const builders = {
  react: { single: regenerateReactFile, batch: regenerateReactFiles, watch: reactWatch },
  vue: { single: regenerateVueFile, batch: regenerateVueFiles, watch: vueWatch },
  angular: { single: regenerateAngularFile, batch: regenerateAngularFiles, watch: angularWatch },
};

for (const [name, builder] of Object.entries(builders)) {
  for (const introspection of [false, true]) {
    describe(`${name} batched library refresh (introspection ${introspection})`, () => {
      it('loads one graph per phase, preserves output, and sees the next library save', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sx-refresh-'));
        const sourceRoot = 'projects/apps/demo/src';
        const source = join(root, sourceRoot);
        const output = join(root, '.angular/.streamix/demo/src');
        try {
          await mkdir(source, { recursive: true });
          await mkdir(join(root, 'libs'), { recursive: true });
          const compilerOptions = { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'preserve', noLib: true };
          await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions,
            include: ['projects/apps/demo/src/**/*', 'libs/**/*'] }));
          await writeFile(join(source, '../tsconfig.app.json'), JSON.stringify({ extends: '../../../tsconfig.json',
            include: ['src/**/*', '../../../libs/**/*'] }));
          // This non-overlaid declaration is read exactly once by each full
          // semantic program. Local noResolve lowering programs never read it.
          const probe = join(root, 'libs/graph-probe.d.ts');
          await writeFile(probe, 'declare const graphProbe: unique symbol;');
          const library = join(root, 'libs/store.ts');
          await writeFile(library, 'export declare const status: string;');
          const script = (view: boolean) => `import { atom } from '@epikodelabs/streamix';
import { status } from '../../../../libs/store';
export const local = atom(1);
${view ? 'export function View() { return <output>{status}</output>; }' : 'export const label = status;'}
`;
          const files = name === 'react' ? ['One.tsx', 'Two.tsx', 'main.ts'] : ['one.ts', 'two.ts', 'main.ts'];
          for (const file of files) await writeFile(join(source, file), script(file.endsWith('tsx')));
          if (name === 'vue') {
            files.push('Counter.vue');
            await writeFile(join(source, 'Counter.vue'), `<script setup lang="ts">import { atom } from '@epikodelabs/streamix'; const count = atom(1);</script><template>{{ count }}</template>`);
          }
          let graphLoads = 0;
          const read = ts.sys.readFile.bind(ts.sys);
          const canonical = (path: string) => resolve(path).replace(/\\/g, '/').toLowerCase();
          spyOn(ts.sys, 'readFile').and.callFake((path, encoding) => {
            if (canonical(path) === canonical(probe)) graphLoads += 1;
            return read(path, encoding);
          });
          const snapshot = async () => {
            const result: Record<string, string> = {};
            for (const file of files) {
              result[file] = await readFile(join(output, file), 'utf8');
              try { result[`${file}.map`] = await readFile(join(output, `${file}.map`), 'utf8'); }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            }
            return result;
          };
          // Baseline cost and emitted bytes from independent file regeneration.
          for (const file of files) await builder.single(root, sourceRoot, file, introspection);
          const phases = name === 'react' ? (introspection ? 2 : 1) : name === 'vue' ? (introspection ? 1 : 0) : 1;
          expect(graphLoads).toBe(files.length * phases);
          const ordinary = await snapshot();
          graphLoads = 0;
          let refreshes = 0;
          await builder.watch.refreshApplication(root, sourceRoot, async (workspace, source, paths) => {
            refreshes += 1;
            await builder.batch(workspace, source, paths, introspection);
          });
          expect(refreshes).toBe(1);
          expect(graphLoads).toBe(phases);
          expect(await snapshot()).toEqual(ordinary);

          await writeFile(library, "export { status } from './model';");
          await writeFile(join(root, 'libs/model.ts'), `export interface AtomLike<T> { readonly value: T; subscribe(callback: () => void): () => void; }
export declare const status: AtomLike<string>;`);
          graphLoads = 0;
          await builder.batch(root, sourceRoot, files, introspection);
          expect(graphLoads).toBe(phases);
          const reactive = await snapshot();
          if (name === 'react') {
            expect(ordinary['One.tsx']).not.toContain('useStreamixSource(status');
            expect(reactive['One.tsx']).toContain('useStreamixSource(status');
            expect(reactive['Two.tsx']).toContain('useStreamixSource(status');
          }
          for (const file of files) await builder.single(root, sourceRoot, file, introspection);
          expect(await snapshot()).toEqual(reactive);
          if (introspection) {
            expect(reactive['main.ts']).toContain('__sxEnable();');
            expect(reactive[files[0]]).toContain('__sxDebug');
            if (name === 'vue') expect(reactive['Counter.vue']).toContain('__sxDebug');
          }
        } finally { await rm(root, { recursive: true, force: true }); }
      });
    });
  }
}
