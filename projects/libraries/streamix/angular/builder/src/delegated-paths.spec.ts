import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Architect, createBuilder } from '@angular-devkit/architect';
import { TestingArchitectHost } from '@angular-devkit/architect/testing/index.js';
import { buildApplication, type ApplicationBuilderOptions } from '@angular/build';
import { logging } from '@angular-devkit/core';
import { virtualApplicationPathOverrides } from '@epikodelabs/streamix/compiler';
import { applicationBuilder as angular } from './application';
import { applicationBuilder as react } from '../../../react/builder/src/application';
import { applicationBuilder as vue } from '../../../vue/builder/src/application';
import { viteBuilder } from '../../../vue/builder/src/vite';

describe('virtual application delegate paths', () => {
  const sourceRoot = 'projects/apps/demo/src';
  const virtualRoot = '.angular/.streamix/demo/src';

  it('maps replacement endpoints independently and preserves absent SSR files and boolean options', () => {
    const configured = {
      fileReplacements: [
        { replace: './projects\\apps\\demo\\src\\env.ts', with: 'shared/production.ts' },
        { replace: 'projects/apps/demo/src-backup/env.ts', with: sourceRoot + '/env.prod.ts' },
      ],
      server: sourceRoot + '/missing.ts',
      ssr: { entry: sourceRoot + '/server.ts', experimentalPlatform: 'node' },
      prerender: { routesFile: sourceRoot + '/routes.txt' },
    };
    expect(virtualApplicationPathOverrides(configured, {
      prerender: false, ssr: { experimentalPlatform: 'neutral' },
    }, sourceRoot, virtualRoot,
      path => path === virtualRoot + '/server.ts')).toEqual({
      fileReplacements: [
        { replace: virtualRoot + '/env.ts', with: 'shared/production.ts' },
        { replace: 'projects/apps/demo/src-backup/env.ts', with: virtualRoot + '/env.prod.ts' },
      ],
      ssr: { entry: virtualRoot + '/server.ts', experimentalPlatform: 'neutral' },
    });
  });

  for (const [framework, builder] of Object.entries({ angular, react })) {
    it(`builds production replacements and generated server code for ${framework}`, async () => {
      const dist = join(process.cwd(), 'dist');
      await mkdir(dist, { recursive: true });
      const workspace = await mkdtemp(join(dist, 'streamix-delegated-paths-'));
      try {
        const source = join(workspace, sourceRoot);
        await mkdir(source, { recursive: true });
        const write = (file: string, body: string) => writeFile(join(source, file), body);
        const angularApp = framework === 'angular';
        const app = angularApp ? 'app.ts' : 'app.tsx';
        await writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({
          compilerOptions: {
            target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
            experimentalDecorators: true, jsx: 'react-jsx', skipLibCheck: true, types: [],
          },
          include: [sourceRoot + '/**/*'],
        }));
        await writeFile(join(source, '../tsconfig.app.json'), JSON.stringify({
          extends: '../../../tsconfig.json', include: ['src/**/*'],
        }));
        await write('types.ts', `
          declare module '@epikodelabs/streamix' {
            export interface Writable<T> { type: 'atom'; value: T; subscribe(cb: () => void): () => void; set(value: T): void; }
            export function atom<T>(value: T): Writable<T>;
          }
          declare module '@epikodelabs/streamix/angular';
          declare module '@epikodelabs/streamix/react';
        `);
        await write('env.ts', 'export const label = "fixture-development";');
        await write('env.prod.ts', 'export const label = "fixture-production";');
        await write('main.ts', 'import { label } from "./env"; console.log(label);');
        await write('index.html', '<!doctype html><html><head><title>Fixture</title></head><body><fixture-app></fixture-app></body></html>');
        await write('routes.txt', '/fixture');
        await write('main.server.ts', 'export { App as default } from "./app";');
        await write('server.ts', 'export { App as handler } from "./app";');
        await write(app, angularApp ? `
          import { Component } from '@angular/core';
          import { atom } from '@epikodelabs/streamix';
          @Component({ selector: 'fixture-app', template: '@if (visible) { <p>compiled block</p> }' })
          export class App { readonly visible = atom(true); }
        ` : `
          import { atom } from '@epikodelabs/streamix';
          const count = atom(1);
          export function App() { return <output>{count}</output>; }
        `);

        const host = new TestingArchitectHost(workspace, workspace);
        host.getProjectMetadata = async () => ({
          root: 'projects/apps/demo', sourceRoot, cli: { cache: { enabled: false } },
        });
        host.addBuilder('fixture:streamix', builder);
        host.addBuilder('@angular/build:application', createBuilder((options, context) => {
          expect(options['server']).toBe(virtualRoot + '/main.server.ts');
          expect(options['ssr']).toEqual({ entry: virtualRoot + '/server.ts' });
          expect(options['prerender']).toEqual({ routesFile: virtualRoot + '/routes.txt', discoverRoutes: false });
          // Compile both server bundles without loading the external SSR engine.
          const application = { ...(options as ApplicationBuilderOptions), partialSSRBuild: true };
          return buildApplication(application, context);
        }));
        host.addTarget({ project: 'demo', target: 'build', configuration: 'production' }, 'fixture:streamix', {
          sourceRoot, delegateTarget: 'demo:application',
        });
        host.addTarget({ project: 'demo', target: 'application', configuration: 'production' }, '@angular/build:application', {
          browser: virtualRoot + '/main.ts', tsConfig: '.angular/.streamix/demo/tsconfig.app.json',
          outputPath: 'out', index: sourceRoot + '/index.html', optimization: false, progress: false,
          outputMode: 'server', server: sourceRoot + '/main.server.ts',
          ssr: { entry: sourceRoot + '/server.ts' },
          prerender: { routesFile: sourceRoot + '/routes.txt', discoverRoutes: false },
          fileReplacements: [{ replace: sourceRoot + '/env.ts', with: sourceRoot + '/env.prod.ts' }],
          externalDependencies: [
            '@angular/ssr', '@epikodelabs/streamix', '@epikodelabs/streamix/angular', '@epikodelabs/streamix/react',
          ],
        });
        const logger = new logging.Logger('fixture');
        const messages: string[] = [];
        const log = logger.subscribe(entry => messages.push(entry.message));
        const run = await new Architect(host).scheduleTarget(
          { project: 'demo', target: 'build', configuration: 'production' }, {}, { logger },
        );
        try {
          const result = await run.result;
          expect(result.success).withContext(messages.join('\n')).toBeTrue();
          if (!result.success) return;
          const browser = await readFile(join(workspace, 'out/browser/main.js'), 'utf8');
          expect(browser).toContain('fixture-production');
          expect(browser).not.toContain('fixture-development');
          const server = await readFile(join(workspace, 'out/server/main.server.mjs'), 'utf8');
          const entry = await readFile(join(workspace, 'out/server/server.mjs'), 'utf8');
          expect(entry).toContain('handler');
          const marker = angularApp ? 'data-sx-block' : 'useStreamixSource';
          // The entry and bootstrap can share the compiled component in a chunk.
          const chunks = await Promise.all((await readdir(join(workspace, 'out/server')))
            .filter(file => file.startsWith('chunk-') && file.endsWith('.mjs'))
            .map(file => readFile(join(workspace, 'out/server', file), 'utf8')));
          expect([server, entry, ...chunks].join('\n')).toContain(marker);
        } finally {
          await run.stop();
          log.unsubscribe();
        }
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }, 60_000);
  }

  it('builds Vue SSR from virtual copies of absolute authored Vite entries and aliases', async () => {
    const dist = join(process.cwd(), 'dist');
    await mkdir(dist, { recursive: true });
    const workspace = await mkdtemp(join(dist, 'streamix-vue-delegate-'));
    try {
      const source = join(workspace, sourceRoot);
      await mkdir(source, { recursive: true });
      const write = (file: string, body: string) => writeFile(join(source, file), body);
      await write('env.ts', 'export const label = "fixture-development";');
      await write('env.prod.ts', 'export const label = "fixture-production";');
      await write('server.ts', 'export { label } from "@fixture-env"; export { default as App } from "./App.vue";');
      await write('App.vue', `
        <script setup>
          import { atom } from '@epikodelabs/streamix';
          const count = atom(1);
        </script>
        <template><output>{{ count }}</output></template>
      `);
      await write('vite.config.ts', `
        import { resolve } from 'node:path';
        const authored = ${JSON.stringify(source)};
        const entry = resolve(authored, 'server.ts');
        const external = resolve(authored, '../external.ts');
        export default ({ mode }) => ({
          resolve: { alias: {
            '@fixture-env': resolve(authored, mode === 'production' ? 'env.prod.ts' : 'env.ts'),
            '@external': external,
          } },
          build: {
            ssr: entry,
            rolldownOptions: {
              input: { server: entry },
              external: ['@epikodelabs/streamix', '@epikodelabs/streamix/vue'],
            },
          },
          plugins: [{
            name: 'verify-virtual-inputs',
            configResolved(config) {
              const normalize = path => path.replaceAll('\\\\', '/');
              const expectedEntry = normalize(resolve(config.root, 'server.ts'));
              const aliases = new Map(config.resolve.alias.map(({ find, replacement }) => [find, replacement]));
              if (config.build.ssr !== expectedEntry || config.build.rolldownOptions.input.server !== expectedEntry ||
                  aliases.get('@fixture-env') !== normalize(resolve(config.root, 'env.prod.ts')) ||
                  normalize(aliases.get('@external')) !== normalize(external)) {
                throw new Error('Expected virtual Vite paths and an untouched external alias');
              }
            },
          }],
        });
      `);
      const host = new TestingArchitectHost(workspace, workspace);
      host.addBuilder('fixture:vue', vue);
      host.addBuilder('@epikodelabs/streamix/vue/builder:vite', viteBuilder);
      host.addTarget({ project: 'demo', target: 'build', configuration: 'production' }, 'fixture:vue', {
        sourceRoot, delegateTarget: 'demo:vite',
      });
      host.addTarget({ project: 'demo', target: 'vite', configuration: 'production' }, '@epikodelabs/streamix/vue/builder:vite', {
        root: virtualRoot, outputPath: 'out',
      });
      const run = await new Architect(host).scheduleTarget({ project: 'demo', target: 'build', configuration: 'production' });
      try {
        expect((await run.result).success).toBeTrue();
        const output = join(workspace, 'out');
        const bundles = await Promise.all((await readdir(output))
          .filter(file => /\.[cm]?js$/.test(file))
          .map(file => readFile(join(output, file), 'utf8')));
        const server = bundles.join('\n');
        expect(server).toContain('fixture-production');
        expect(server).not.toContain('fixture-development');
        expect(server).toContain('useWritable');
      } finally {
        await run.stop();
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 60_000);
});
