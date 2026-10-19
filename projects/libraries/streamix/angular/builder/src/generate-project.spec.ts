import { rewriteDerivedAtomReads } from './generate-project';

describe('Angular derived shorthand', () => {
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

  it('preserves DerivedScope tracker arguments as atom references', () => {
    const transformed = rewriteDerivedAtomReads(`
      const count = atom(2);
      const summary = derived($ => $(count));
    `);

    expect(transformed).toContain('derived($ => $(count))');
    expect(transformed).not.toContain('$(count.value)');
  });
});


describe('external Angular component templates', () => {
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
      await generateProject({ workspaceRoot: root, sourceRoot: 'projects/apps/demo/src' });
      const generated = await readFile(join(root, '.angular/.streamix/demo/src/counter.ts'), 'utf8');
      expect(generated).toContain('template: `');
      expect(generated).not.toContain('templateUrl');
      expect(await readFile(join(src, 'counter.html'), 'utf8')).toBe(template);
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
      expect(debug.indexOf('__sxEnable();')).toBeLessThan(debug.indexOf('export const count'));
      expect(debug).toContain('__sxMount();');
      await generateProject({ workspaceRoot: root, sourceRoot, introspection: false });
      expect(await readFile(generatedPath, 'utf8')).toBe(original);
      expect(await readFile(join(src, 'main.ts'), 'utf8')).toBe(original);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('normalizes derived shorthand through debug wrappers', () => {
    const result = rewriteDerivedAtomReads('const count = __sxDebug(atom(1), {}); const total = __sxDebug(derived(() => count * 2), {});');
    expect(result).toContain('count.value * 2');
  });
});
