import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { generateProject } from '../../angular/builder/src/generate-project';
import { generateReactProject } from '../../react/builder/src/generate-project';
import { generateVueProject } from '../../vue/builder/src/generate-project';

describe('generated application roots with an authored rootDir', () => {
  const sourceRoot = 'projects/apps/demo/src';
  let workspace: string;
  let authored: string;
  let virtual: string;
  let shared: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'streamix-virtual-root-'));
    authored = join(workspace, sourceRoot, 'main.ts');
    virtual = join(workspace, '.angular/.streamix/demo/src/main.ts');
    shared = join(workspace, 'projects/shared/value.ts');
    await mkdir(dirname(authored), { recursive: true });
    await mkdir(dirname(shared), { recursive: true });
    await writeFile(shared, 'export const value = 42;');
    await writeFile(authored, 'import { value } from "@fixture/value"; export const result: number = value;');
    await writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        rootDir: sourceRoot,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        paths: { '@fixture/value': ['./projects/shared/value.ts'] },
        types: [],
      },
      files: [sourceRoot + '/main.ts'],
    }));
    await writeFile(join(dirname(authored), '../tsconfig.app.json'), JSON.stringify({
      extends: '../../../tsconfig.json',
      files: ['./src/main.ts'],
    }));
  });

  afterEach(async () => {
    await rm(workspace, { force: true, recursive: true });
  });

  const generators = {
    React: (workspaceRoot: string) => generateReactProject(workspaceRoot, sourceRoot),
    Angular: (workspaceRoot: string) => generateProject({ workspaceRoot, sourceRoot }),
  };

  for (const [framework, generate] of Object.entries(generators)) {
    it(`type-checks the virtual ${framework} entry and its workspace import`, async () => {
      await generate(workspace);
      const configPath = join(dirname(virtual), '../tsconfig.app.json');
      const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: diagnostic =>
          fail(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
      })!;
      expect(config.errors).toEqual([]);
      const program = ts.createProgram(config.fileNames, config.options);
      expect(program.getRootFileNames().map(file => resolve(file))).toEqual([virtual]);
      expect(program.getSourceFile(virtual)).toBeDefined();
      expect(program.getSourceFile(shared)).toBeDefined();
      expect(program.getOptionsDiagnostics().map(item => item.code)).toEqual([]);
      expect(program.getSemanticDiagnostics().map(item => item.code)).toEqual([]);
    });
  }

  it('bundles the virtual Vue entry and its workspace import without creating a TypeScript project', async () => {
    await generateVueProject(workspace, sourceRoot);
    expect(await readFile(virtual, 'utf8')).toBe(await readFile(authored, 'utf8'));
    await expectAsync(access(join(dirname(virtual), '../tsconfig.app.json')))
      .toBeRejectedWith(jasmine.objectContaining({ code: 'ENOENT' }));
    const { build } = await import('vite');
    await expectAsync(build({
      configFile: false,
      root: dirname(virtual),
      logLevel: 'silent',
      resolve: { alias: { '@fixture/value': shared } },
      build: { write: false, lib: { entry: virtual, formats: ['es'] } },
    })).toBeResolved();
  });
});
