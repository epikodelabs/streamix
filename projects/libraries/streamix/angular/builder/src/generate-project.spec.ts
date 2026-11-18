import { rewriteDerivedAtomReads } from './generate-project';

describe('Angular derived shorthand', () => {
  it('recognizes cast-wrapped class fields and debug wrappers in either order', () => {
    const transformed = rewriteDerivedAtomReads(`
      import { atom, derived, type Writable } from '@epikodelabs/streamix';
      class Counter {
        count = (__sxDebug((atom(2) as Writable<number>), {})) satisfies Writable<number>;
        other = (__sxDebug(atom(3), {}) as Writable<number>);
        total = derived(() => this.count + this.other);
      }
    `);
    expect(transformed).toContain('derived(() => this.count.value + this.other.value)');
  });

  it('lowers chained derived and flow inputs, object members, and shorthand keys', () => {
    const transformed = rewriteDerivedAtomReads(`
      const count = atom(2);
      const doubled = derived(() => count * 2);
      const updates = flow([3]);
      const profile = atom({ name: 'Ada' });
      const summary = derived(() => ({ doubled, total: doubled + updates, name: profile.name }));
    `);
    expect(transformed).toContain('({ doubled: doubled.value, total: doubled.value + updates.value, name: profile.value.name })');
  });

  it('preserves explicit tracked reads regardless of the callback parameter name', () => {
    const transformed = rewriteDerivedAtomReads(`
      const count = atom(2);
      const total = derived(self => self(count) + self.read(count));
    `);
    expect(transformed).toContain('self(count) + self.read(count)');
  });

  it('respects lexical shadowing and unrelated class fields', () => {
    const transformed = rewriteDerivedAtomReads(`
      const count = atom(2);
      const total = derived(() => [1, 2].map(count => count * 2));
      class Reactive { count = atom(1); }
      class Plain { count = 4; total = derived(() => this.count * 2); }
    `);
    expect(transformed).toContain('map(count => count * 2)');
    expect(transformed).toContain('derived(() => this.count * 2)');
  });

  it('recognizes aliased and namespace Streamix factories', () => {
    const transformed = rewriteDerivedAtomReads(`
      import { atom as state, derived as computed } from '@epikodelabs/streamix';
      import * as sx from '@epikodelabs/streamix';
      const count = state(2);
      const total = computed(() => count * 2);
      const other = sx.atom(3);
      const label = sx.derived(() => other + total);
    `);
    expect(transformed).toContain('computed(() => count.value * 2)');
    expect(transformed).toContain('sx.derived(() => other.value + total.value)');
  });

  it('preserves explicit reads and avoids overlapping nested formula edits', () => {
    const transformed = rewriteDerivedAtomReads(`
      const count = atom(2);
      const summary = derived(() => {
        type Source = typeof count;
        return derived(() => count.value + count);
      });
    `);
    expect(transformed).toContain('type Source = typeof count;');
    expect(transformed).toContain('derived(() => count.value + count.value)');
    expect(transformed).not.toContain('.value.value');
  });

  it('does not adopt unrelated imports or shadowed factory functions', () => {
    const transformed = rewriteDerivedAtomReads(`
      import { atom } from 'other-library';
      const count = atom(2);
      const total = derived(() => count * 2);
      function plain(atom: (value: number) => number) {
        const local = atom(3);
        return derived(() => local * 2);
      }
    `);
    expect(transformed).toContain('derived(() => count * 2)');
    expect(transformed).toContain('derived(() => local * 2)');
  });

  it('lowers raw local atom reads inside a derived callback', () => {
    const transformed = rewriteDerivedAtomReads(`
      class Counter {
        price = atom(2);
        quantity = atom(3);
        total = derived(() => this.price * this.quantity);
      }
    `);

    expect(transformed).toContain('derived(() => this.price.value * this.quantity.value)');
  });

  it('lowers lexical atom reads inside a derived callback', () => {
    const transformed = rewriteDerivedAtomReads(`
      const price = atom(2);
      const quantity = atom(3);
      const total = derived(() => price * quantity);
    `);

    expect(transformed).toContain('derived(() => price.value * quantity.value)');
  });

  it('lowers standalone derived callbacks to tracked value reads', () => {
    const transformed = rewriteDerivedAtomReads(`
      const count = atom(2);
      const summary = derived(() => count);
    `);

    expect(transformed).toContain('derived(() => count.value)');
  });
});


describe('external Angular component templates', () => {
  it('adopts cast-wrapped atom and scope fields for native bindings', async () => {
    const { mkdtemp, mkdir, readFile, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-cast-fields-'));
    try {
      const src = join(root, 'projects/apps/demo/src');
      await mkdir(src, { recursive: true });
      await writeFile(join(root, 'projects/apps/demo/tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true }, include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'globals.d.ts'), `
        declare module '@epikodelabs/streamix' {
          export interface Writable<T> { type: 'atom'; value: T; subscribe(cb: () => void): () => void; set(value: T): void; }
          export function atom<T>(value: T): Writable<T>;
          export function scope<T>(value: T): any;
        }
      `);
      await writeFile(join(src, 'counter.ts'), `
        import { atom, scope, type Writable } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ template: '<input [(value)]="model.title"><output>{{ count.value }}</output>' })
        export class Counter {
          count = (atom(2)) as Writable<number>;
          model = (scope({ title: 'ready' })) satisfies unknown;
        }
      `);
      await generateProject({ workspaceRoot: root, sourceRoot: 'projects/apps/demo/src' });
      const generated = await readFile(join(root, '.angular/.streamix/demo/src/counter.ts'), 'utf8');
      expect(generated).toContain('ctx.count');
      expect(generated).toMatch(/ctx\.model\.get\(['"]title['"]\)/);
      expect(generated).toMatch(/ctx\.model\.set\(['"]title['"],\s*event\.target\.value\)/);
      expect(generated).toContain('ownedScopes: () => [this.model]');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('disposes a component scope field even when the template has no bindings', async () => {
    const { mkdtemp, mkdir, readFile, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-scope-only-'));
    try {
      const src = join(root, 'projects/apps/demo/src');
      await mkdir(src, { recursive: true });
      await writeFile(join(root, 'projects/apps/demo/tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true }, include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'globals.d.ts'), `
        declare module '@epikodelabs/streamix' {
          export function scope<T>(value: T): any;
        }
      `);
      await writeFile(join(src, 'panel.ts'), `
        import { scope } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ template: '<p>Static</p>' })
        export class Panel {
          model = scope({ title: 'ready' });
        }
      `);
      await generateProject({ workspaceRoot: root, sourceRoot: 'projects/apps/demo/src' });
      const generated = await readFile(join(root, '.angular/.streamix/demo/src/panel.ts'), 'utf8');
      // No compiled bindings, but the scope is still component-owned.
      expect(generated).toContain('ɵinstallSxCompiledView(');
      expect(generated).toContain('ownedScopes: () => [this.model]');
      expect(generated).not.toContain('ɵsetupSxBindings');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('owns constructor-created scopes and maps their template members', async () => {
    const { mkdtemp, mkdir, readFile, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-constructor-scope-'));
    try {
      const src = join(root, 'projects/apps/demo/src');
      await mkdir(src, { recursive: true });
      await writeFile(join(root, 'projects/apps/demo/tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true }, include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'globals.d.ts'), `
        declare module '@epikodelabs/streamix' {
          export function scope<T>(value: T): any;
        }
      `);
      await writeFile(join(src, 'panel.ts'), `
        import { scope } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ template: '<output>{{ model.title }}</output><p>{{ aliased.body }}</p>' })
        export class Panel {
          model: any;
          aliased: any;

          constructor() {
            this.model = scope({ title: 'ready' });
            const local = scope({ body: 'draft' });
            this.aliased = local;
          }
        }
      `);
      await generateProject({ workspaceRoot: root, sourceRoot: 'projects/apps/demo/src' });
      const generated = await readFile(join(root, '.angular/.streamix/demo/src/panel.ts'), 'utf8');
      // Constructor-created scopes are visible to template bindings and are
      // component-owned, including scopes passed through a local variable.
      expect(generated).toContain("model.get('title')");
      expect(generated).toContain("aliased.get('body')");
      expect(generated).toContain('ownedScopes: () => [this.model, this.aliased]');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('installs scope cleanup for a component without a compilable template', async () => {
    const { mkdtemp, mkdir, readFile, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-dynamic-template-'));
    try {
      const src = join(root, 'projects/apps/demo/src');
      await mkdir(src, { recursive: true });
      await writeFile(join(root, 'projects/apps/demo/tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true }, include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'globals.d.ts'), `
        declare module '@epikodelabs/streamix' {
          export function scope<T>(value: T): any;
        }
      `);
      await writeFile(join(src, 'panel.ts'), `
        import { scope } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({})
        export class Panel {
          model = scope({ title: 'ready' });
        }
      `);
      await generateProject({ workspaceRoot: root, sourceRoot: 'projects/apps/demo/src' });
      const generated = await readFile(join(root, '.angular/.streamix/demo/src/panel.ts'), 'utf8');
      // No template to transform, but the scope still needs a lifetime owner.
      expect(generated).toContain('ɵinstallSxCompiledView(');
      expect(generated).toContain('ownedScopes: () => [this.model]');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('bridges nested scope values and leaves method members callable', async () => {
    const { mkdtemp, mkdir, readFile, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-nested-scope-'));
    try {
      const src = join(root, 'projects/apps/demo/src');
      await mkdir(src, { recursive: true });
      await writeFile(join(root, 'projects/apps/demo/tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true }, include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'globals.d.ts'), `
        declare module '@epikodelabs/streamix' {
          export function scope<T>(value: T): any;
          export function method<T>(fn: T): T;
        }
      `);
      await writeFile(join(src, 'profile.ts'), `
        import { method, scope } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ template: '<output>{{ model.profile.name }}</output><button (click)="model.increment()">+</button>' })
        export class Profile {
          model = scope({
            profile: { name: 'Ada' },
            increment: method((self: any) => { self.profile.name = 'Grace'; }),
          });
        }
      `);
      await generateProject({ workspaceRoot: root, sourceRoot: 'projects/apps/demo/src' });
      const generated = await readFile(join(root, '.angular/.streamix/demo/src/profile.ts'), 'utf8');
      expect(generated).toContain("model.get('profile').get('name')");
      // The method member stays a method call; it is never treated as a source.
      expect(generated).toContain('ctx.model.increment()');
      expect(generated).not.toContain("model.get('increment')");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('compiles an authored templateUrl without changing the authored HTML file', async () => {
    const { mkdtemp, mkdir, readFile, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-external-template-'));
    try {
      const src = join(root, 'projects/apps/demo/src');
      await mkdir(src, { recursive: true });
      await writeFile(join(root, 'projects/apps/demo/tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true, moduleResolution: 'Node' },
        include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'counter.ts'), `
        import { atom } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ templateUrl: './counter.html' })
        export class Counter { count = atom(1); }
      `);
      const template = '<output>{{ count.value }}</output>';
      await writeFile(join(src, 'counter.html'), template);
      // Native value bindings are only adopted with resolver proof of a
      // genuine reactive source; the synthetic workspace must type `atom`.
      await writeFile(join(src, 'globals.d.ts'), [
        'declare module "@epikodelabs/streamix" {',
        '  export function atom<T>(value: T): { type: string; value: T; subscribe(cb: () => void): () => void };',
        '}',
      ].join('\n'));
      await generateProject({ workspaceRoot: root, sourceRoot: 'projects/apps/demo/src' });
      const generated = await readFile(join(root, '.angular/.streamix/demo/src/counter.ts'), 'utf8');
      expect(generated).toContain('template: `');
      expect(generated).not.toContain('templateUrl');
      // The authored-position map chains through esbuild like the React builder's.
      const map = JSON.parse(await readFile(join(root, '.angular/.streamix/demo/src/counter.ts.map'), 'utf8'));
      expect(map.version).toBe(3);
      expect(map.sources).toEqual(['projects/apps/demo/src/counter.ts']);
      expect(map.sourcesContent[0]).toContain('export class Counter');
      expect(generated.trimEnd().endsWith('//# sourceMappingURL=counter.ts.map')).toBe(true);
      expect(await readFile(join(src, 'counter.html'), 'utf8')).toBe(template);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});


describe('Angular staged regeneration', () => {
  /** Content snapshot of every file under a tree, keyed by slash-relative path. */
  async function snapshotTree(root: string): Promise<Record<string, string>> {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join, relative } = await import('node:path');
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

  it('preserves previously generated project when a later component fails compilation', async () => {
    const { mkdtemp, mkdir, readdir, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-staged-regeneration-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const src = join(root, sourceRoot);
      await mkdir(src, { recursive: true });
      await writeFile(join(src, '..', 'tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true, moduleResolution: 'Node' },
        include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'counter.ts'), `
        import { atom } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ templateUrl: './counter.html' })
        export class Counter { count = atom(1); }
      `);
      await writeFile(join(src, 'counter.html'), '<output>{{ count.value }}</output>');
      await generateProject({ workspaceRoot: root, sourceRoot });
      const before = await snapshotTree(join(root, '.angular'));
      await writeFile(join(src, 'broken.ts'), `
        import { atom } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ template: '<p>one</p>' }) export class One { count = atom(1); }
        @Component({ template: '<p>two</p>' }) export class Two { count = atom(2); }
      `);
      await expectAsync(generateProject({ workspaceRoot: root, sourceRoot }))
        .toBeRejectedWithError(/multiple @Component classes/);
      // The failed pass must not touch one byte of the served virtual tree.
      expect(await snapshotTree(join(root, '.angular'))).toEqual(before);
      const siblings = await readdir(join(root, '.angular/.streamix/demo'));
      expect(siblings.filter(name => name.includes('sx-stage') || name.includes('sx-backup'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores the committed virtual project when the post-swap tsconfig install fails', async () => {
    const { mkdtemp, mkdir, readdir, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-tsconfig-rollback-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const src = join(root, sourceRoot);
      await mkdir(src, { recursive: true });
      await writeFile(join(src, '..', 'tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true, moduleResolution: 'Node' },
        include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'counter.ts'), `
        import { atom } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ templateUrl: './counter.html' })
        export class Counter { count = atom(1); }
      `);
      await writeFile(join(src, 'counter.html'), '<output>{{ count.value }}</output>');
      await generateProject({ workspaceRoot: root, sourceRoot });
      const virtualRoot = join(root, '.angular/.streamix/demo/src');
      const before = await snapshotTree(virtualRoot);
      // The swap succeeds and only the virtual config install fails. An empty
      // directory at that path makes the final rename fail on every platform.
      const configPath = join(root, '.angular/.streamix/demo/tsconfig.app.json');
      await rm(configPath, { force: true });
      await mkdir(configPath);
      await writeFile(join(src, 'counter.html'), '<output>{{ count.value }} changed</output>');

      await expectAsync(generateProject({ workspaceRoot: root, sourceRoot })).toBeRejected();

      // The uncommitted generation is discarded, never served.
      expect(await snapshotTree(virtualRoot)).toEqual(before);
      const siblings = await readdir(join(root, '.angular/.streamix/demo'));
      expect(siblings.filter(name => /sx-(?:stage|backup|tmp)/.test(name))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('regenerates a single authored component in place on a watch edit', async () => {
    const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject, regenerateAngularFile } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-per-file-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const src = join(root, sourceRoot);
      await mkdir(src, { recursive: true });
      await writeFile(join(src, '..', 'tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true, moduleResolution: 'Node' },
        include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'counter.ts'), `
        import { atom } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ templateUrl: './counter.html' })
        export class Counter { count = atom(1); }
      `);
      await writeFile(join(src, 'counter.html'), '<output>{{ count.value }}</output>');
      await writeFile(join(src, 'globals.d.ts'), [
        'declare module "@epikodelabs/streamix" {',
        '  export function atom<T>(value: T): { type: string; value: T; subscribe(cb: () => void): () => void };',
        '}',
      ].join('\n'));
      await generateProject({ workspaceRoot: root, sourceRoot });
      const virtualPath = join(root, '.angular/.streamix/demo/src/counter.ts');
      const before = await readFile(virtualPath, 'utf8');
      await writeFile(join(src, 'counter.ts'), `
        import { atom } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ templateUrl: './counter.html' })
        export class Counter { count = atom(42); }
      `);
      await regenerateAngularFile(root, sourceRoot, 'counter.ts');
      const updated = await readFile(virtualPath, 'utf8');
      expect(updated).not.toBe(before);
      expect(updated).toContain('atom(42)');
      expect(updated).toContain('template: `');
      expect(JSON.parse(await readFile(`${virtualPath}.map`, 'utf8')).version).toBe(3);
      // Authored source stays clean; the virtual tree carries the rewrite.
      expect(await readFile(join(src, 'counter.ts'), 'utf8')).toContain('atom(42)');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('mirrors deletions and routes template edits through a full staged pass', async () => {
    const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject, regenerateAngularFile } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-per-file-delete-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const src = join(root, sourceRoot);
      await mkdir(src, { recursive: true });
      await writeFile(join(src, '..', 'tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true, moduleResolution: 'Node' },
        include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'counter.ts'), `
        import { atom } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ templateUrl: './counter.html' })
        export class Counter { count = atom(1); }
      `);
      await writeFile(join(src, 'counter.html'), '<output>{{ count.value }}</output>');
      await writeFile(join(src, 'globals.d.ts'), [
        'declare module "@epikodelabs/streamix" {',
        '  export function atom<T>(value: T): { type: string; value: T; subscribe(cb: () => void): () => void };',
        '}',
      ].join('\n'));
      await generateProject({ workspaceRoot: root, sourceRoot });
      const virtualPath = join(root, '.angular/.streamix/demo/src/counter.ts');
      // Deleting the authored component removes its virtual twin and map.
      await rm(join(src, 'counter.ts'));
      await regenerateAngularFile(root, sourceRoot, 'counter.ts');
      await expectAsync(readFile(virtualPath, 'utf8')).toBeRejected();
      await expectAsync(readFile(`${virtualPath}.map`, 'utf8')).toBeRejected();
      // A template edit can affect any component referencing it: full pass.
      await regenerateAngularFile(root, sourceRoot, 'counter.html');
      expect(await readFile(join(src, 'counter.html'), 'utf8')).toBe('<output>{{ count.value }}</output>');
      await expectAsync(readFile(virtualPath, 'utf8')).toBeRejected();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects absolute and traversing source roots before modifying generated files', async () => {
    const { mkdtemp, readdir, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-root-validation-'));
    try {
      for (const invalid of ['', '.', '..', '../outside', '/tmp/source', 'C:\\source', '.angular/source', 'node_modules/x', 'projects/./src']) {
        await expectAsync(generateProject({ workspaceRoot: root, sourceRoot: invalid })).toBeRejectedWithError(/sourceRoot/);
      }
      // Nothing was created for any rejected root.
      expect(await readdir(root)).not.toContain('.angular');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('recovers a tree abandoned by a crashed generation', async () => {
    const { mkdtemp, mkdir, rename, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-crash-recovery-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const src = join(root, sourceRoot);
      await mkdir(src, { recursive: true });
      await writeFile(join(src, '..', 'tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true, moduleResolution: 'Node' },
        include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'counter.ts'), `
        import { atom } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ templateUrl: './counter.html' })
        export class Counter { count = atom(1); }
      `);
      await writeFile(join(src, 'counter.html'), '<output>{{ count.value }}</output>');
      // Native value bindings are only adopted with resolver proof of a
      // genuine reactive source; the synthetic workspace must type `atom`.
      await writeFile(join(src, 'globals.d.ts'), [
        'declare module "@epikodelabs/streamix" {',
        '  export function atom<T>(value: T): { type: string; value: T; subscribe(cb: () => void): () => void };',
        '}',
      ].join('\n'));
      await generateProject({ workspaceRoot: root, sourceRoot });
      const before = await snapshotTree(join(root, '.angular'));
      // Simulate a crash between the backup and install renames: the live
      // tree is missing, the last good generation sits in an orphaned backup,
      // and a failed stage lingers beside it.
      const appDir = join(root, '.angular/.streamix/demo');
      await rename(join(appDir, 'src'), join(appDir, '.src-sx-backup-11111111-2222-3333-4444-555555555555'));
      await mkdir(join(appDir, '.src-sx-stage-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), { recursive: true });
      await writeFile(join(src, 'broken.ts'), `
        import { atom } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ template: '<p>one</p>' }) export class One { count = atom(1); }
        @Component({ template: '<p>two</p>' }) export class Two { count = atom(2); }
      `);
      await expectAsync(generateProject({ workspaceRoot: root, sourceRoot }))
        .toBeRejectedWithError(/multiple @Component classes/);
      // The sweep restored the backup into the live tree and cleaned the
      // abandoned stage before the failing pass ran.
      expect(await snapshotTree(join(root, '.angular'))).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});


describe('Angular debug project generation', () => {
  it('instruments original source locations and removes instrumentation on a subsequent production pass', async () => {
    const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-debug-generation-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const src = join(root, sourceRoot);
      await mkdir(src, { recursive: true });
      await writeFile(join(src, '..', 'tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', moduleResolution: 'Node' }, include: ['src/**/*.ts'],
      }));
      const original = "import { atom as state } from '@epikodelabs/streamix';\nexport const count = state(0);\n";
      await writeFile(join(src, 'main.ts'), original);
      const generatedPath = join(root, '.angular/.streamix/demo/src/main.ts');
      await generateProject({ workspaceRoot: root, sourceRoot, introspection: true });
      const debug = await readFile(generatedPath, 'utf8');
      expect(debug).toContain('__sxDebug(state(0),');
      expect(debug).toContain('"file":"projects/apps/demo/src/main.ts","line":2');
      expect(debug.indexOf('introspection/activate')).toBeLessThan(debug.indexOf('export const count'));
      expect(debug).toContain('__sxMount();');
      await generateProject({ workspaceRoot: root, sourceRoot, introspection: false });
      expect(await readFile(generatedPath, 'utf8')).toBe(original);
      expect(await readFile(join(src, 'main.ts'), 'utf8')).toBe(original);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('instruments files that are not roots of the app tsconfig', async () => {
    const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-plain-generation-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const src = join(root, sourceRoot);
      await mkdir(src, { recursive: true });
      await writeFile(join(src, '..', 'tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', moduleResolution: 'Node' },
        files: ['src/main.ts'],
      }));
      await writeFile(join(src, 'main.ts'), `export const start = () => 'ok';\n`);
      const helper = `export class Counter {\n  private value = 0;\n  increment() { return ++this.value; }\n}\n`;
      await writeFile(join(src, 'helper.ts'), helper);
      await generateProject({ workspaceRoot: root, sourceRoot, introspection: true });
      expect(await readFile(join(root, '.angular/.streamix/demo/src/main.ts'), 'utf8')).toContain('introspection/activate');
      expect(await readFile(join(root, '.angular/.streamix/demo/src/helper.ts'), 'utf8')).toBe(helper);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('normalizes derived shorthand through debug wrappers', () => {
    const result = rewriteDerivedAtomReads('const count = __sxDebug(atom(1), {}); const total = __sxDebug(derived(() => count * 2), {});');
    expect(result).toContain('count.value * 2');
  });
});

describe('Angular diagnostic paths', () => {
  it('reports the same authored path for full and watch compilation errors', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { generateProject, regenerateAngularFile } = await import('./generate-project');
    const root = await mkdtemp(join(tmpdir(), 'sx-diagnostic-path-'));
    const sourceRoot = 'projects/apps/demo/src';
    try {
      const src = join(root, sourceRoot);
      await mkdir(src, { recursive: true });
      await writeFile(join(src, '..', 'tsconfig.app.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', experimentalDecorators: true, moduleResolution: 'Node' },
        include: ['src/**/*.ts'],
      }));
      await writeFile(join(src, 'broken.ts'), `
        import { atom } from '@epikodelabs/streamix';
        declare function Component(meta: object): ClassDecorator;
        @Component({ template: '<p>one</p>' }) export class One { count = atom(1); }
        @Component({ template: '<p>two</p>' }) export class Two { count = atom(2); }
      `);

      const capture = (promise: Promise<unknown>): Promise<Error> =>
        promise.then(() => { throw new Error('Expected regeneration to fail'); }, error => error as Error);
      const fullError = await capture(generateProject({ workspaceRoot: root, sourceRoot }));
      const watchError = await capture(regenerateAngularFile(root, sourceRoot, 'broken.ts'));

      const authored = '[streamix] broken.ts:';
      expect(fullError.message.startsWith(authored)).toBeTrue();
      expect(watchError.message.startsWith(authored)).toBeTrue();
      expect(watchError.message).toBe(fullError.message);
      expect(fullError.message).not.toContain('.angular/.streamix');
      expect(fullError.message).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
