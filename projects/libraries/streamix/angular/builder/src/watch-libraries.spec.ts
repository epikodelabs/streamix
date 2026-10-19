import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as angular from './watch-libraries';
import * as react from '../../../react/builder/src/watch-libraries';
import * as vue from '../../../vue/builder/src/watch-libraries';

for (const [name, builder] of Object.entries({ angular, react, vue })) {
  describe(`${name} workspace library watch`, () => {
    let root: string;
    const sourceRoot = 'apps/demo/src';
    let stop = () => {};
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'sx-library-watch-'));
      await mkdir(join(root, sourceRoot), { recursive: true });
      await mkdir(join(root, 'libs/shared/src'), { recursive: true });
      await mkdir(join(root, '.angular/generated'), { recursive: true });
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', moduleResolution: 'Bundler', module: 'ESNext',
          paths: { '@shared': ['./libs/shared/src/index.ts'] } },
      }));
      await writeFile(join(root, 'apps/demo/tsconfig.app.json'), JSON.stringify({
        extends: '../../tsconfig.json', include: ['src/**/*.ts'],
      }));
      await writeFile(join(root, sourceRoot, 'main.ts'), "import { value } from '@shared'; export { value };");
      await writeFile(join(root, 'libs/shared/src/index.ts'), 'export const value = 1;');
    });
    afterEach(async () => { stop(); await rm(root, { recursive: true, force: true }); });

    it('resolves inherited library aliases relative to their defining config', () => {
      expect(builder.libraryWatchRoots(root, sourceRoot)).toEqual([join(root, 'libs/shared/src')]);
    });

    it('refreshes authored modules in place when a library changes', async () => {
      const refreshed: string[] = [];
      let changed!: () => void;
      const change = new Promise<void>(resolve => { changed = resolve; });
      const warnings: string[] = [];
      stop = builder.watchLibraries(root, sourceRoot, () => {
        void builder.refreshApplication(root, sourceRoot, async (_root, _source, file) => {
          refreshed.push(file);
        }).then(changed);
      }, message => warnings.push(message));
      await writeFile(join(root, 'libs/shared/src/index.ts'), 'export const value = 2;');
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([change, new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Library edit did not trigger regeneration')), 4000);
        })]);
      } finally { clearTimeout(timeout); }
      expect(refreshed).toEqual(['main.ts']);
      expect(warnings).toEqual([]);
    });

    it('ignores generated output and dependencies installed under node_modules', async () => {
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { paths: {
          '@generated': ['./.angular/generated/index.ts'],
          '@installed': ['./node_modules/installed/index.ts'],
        } },
      }));
      expect(builder.libraryWatchRoots(root, sourceRoot)).toEqual([]);
    });
  });
}
