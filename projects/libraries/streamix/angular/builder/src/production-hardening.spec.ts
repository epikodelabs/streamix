import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateProject } from './generate-project';

async function fixture(component: string): Promise<{
  root: string;
  sourceRoot: string;
  appRoot: string;
  dispose(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'streamix-angular-release-'));
  const appRoot = join(root, 'projects/apps/demo');
  const sourceRoot = 'projects/apps/demo/src';
  await mkdir(join(appRoot, 'src'), { recursive: true });
  await writeFile(join(appRoot, 'tsconfig.app.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', experimentalDecorators: true, strict: true },
    include: ['src/**/*.ts'],
  }));
  await writeFile(join(appRoot, 'src', 'component.ts'), component);
  await writeFile(join(appRoot, 'src', 'globals.d.ts'), [
    'declare function Component(metadata: unknown): ClassDecorator;',
    'declare function atom<T>(value: T): { type: string; value: T; subscribe(cb:()=>void):void };',
  ].join('\n'));
  return { root, sourceRoot, appRoot, dispose: () => rm(root, { force: true, recursive: true }) };
}

describe('Angular production compiler fail-closed boundaries', () => {
  it('refuses reactive external templates instead of silently copying stale bindings', async () => {
    const f = await fixture('@Component({templateUrl:"./external.html"}) export class App { count = atom(1); }');
    try {
      await expectAsync(generateProject({ workspaceRoot: f.root, sourceRoot: f.sourceRoot }))
        .toBeRejectedWithError(/component with Streamix sources has no static inline/);
    } finally { await f.dispose(); }
  });

  it('permits ordinary Angular external templates even with an unrelated reactive service', async () => {
    const f = await fixture([
      'class Store { count = atom(1); }',
      '@Component({templateUrl:"./external.html"}) export class App { count = 1; }',
    ].join('\n'));
    try {
      await generateProject({ workspaceRoot: f.root, sourceRoot: f.sourceRoot });
      const copied = await readFile(join(f.root, '.angular/.streamix/demo/src/component.ts'), 'utf8');
      expect(copied).toContain('templateUrl');
    } finally { await f.dispose(); }
  });

  it('refuses multiple reactive components in one file rather than adopting one arbitrarily', async () => {
    const f = await fixture([
      '@Component({template:`<p>one</p>`}) export class One { count = atom(1); }',
      '@Component({template:`<p>two</p>`}) export class Two { count = atom(2); }',
    ].join('\n'));
    try {
      await expectAsync(generateProject({ workspaceRoot: f.root, sourceRoot: f.sourceRoot }))
        .toBeRejectedWithError(/multiple @Component classes/);
    } finally { await f.dispose(); }
  });

  it('reports missing project configuration directly', async () => {
    const f = await fixture('@Component({template:`<p>static</p>`}) export class App {}');
    try {
      await rm(join(f.appRoot, 'tsconfig.app.json'));
      await expectAsync(generateProject({ workspaceRoot: f.root, sourceRoot: f.sourceRoot }))
        .toBeRejectedWithError(/could not read.*tsconfig.app.json/);
    } finally { await f.dispose(); }
  });
});
