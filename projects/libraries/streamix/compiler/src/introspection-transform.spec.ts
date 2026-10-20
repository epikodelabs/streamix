import ts from 'typescript';
import { injectIntrospectionActivation } from './introspection-activation';
import { instrumentStreamixSource } from './introspection-transform';

function transform(source: string, enabled = true): string {
  const declarations = `
    export interface Atom<T> { type: 'atom'; value: T; subscribe(fn?: (v:T)=>void): (() => void) & { readonly unsubscribed: boolean }; }
    export interface Operator { type: 'operator'; apply(source: unknown): unknown; }
    export declare function on(event: string): Atom<unknown>;
    export declare function interval(ms: number): Atom<number>;
    export declare function atom<T>(value: T): Atom<T>;
    export declare function derived<T>(fn: () => T): Atom<T>;
    export declare function flow(value: unknown): Atom<unknown>;
    export declare function pipe(value: unknown, ...ops: Operator[]): Atom<unknown>;
    export declare function map(fn: (value: number) => number): Operator;
    export declare function scope<T>(value: T): T;
  `;
  const files = new Map([['/app.ts', source], ['/streamix.d.ts', declarations]]);
  const host: ts.CompilerHost = {
    getSourceFile: (path, version) => files.has(path) ? ts.createSourceFile(path, files.get(path)!, version, true) : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '/',
    getDirectories: () => [], fileExists: path => files.has(path), readFile: path => files.get(path),
    getCanonicalFileName: path => path, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: names => names.map(() => ({ resolvedFileName: '/streamix.d.ts' })),
  };
  const program = ts.createProgram(['/app.ts'], { noLib: true }, host);
  return instrumentStreamixSource({ file: program.getSourceFile('/app.ts')!, checker: program.getTypeChecker(),
    sourcePath: 'projects/apps/app6/src/app.ts', enabled });
}

describe('Angular debug introspection transform', () => {
  it('resolves aliases and namespace imports while ignoring shadowed functions', () => {
    const source = `import { atom as state } from '@epikodelabs/streamix';
import * as sx from '@epikodelabs/streamix';
const count = state(0);
const other = sx.atom(1);
function local(state: (v: number) => number) { return state(2); }`;
    const result = transform(source);
    expect(result).toContain('__sxDebug(state(0),');
    expect(result).toContain('__sxDebug(sx.atom(1),');
    expect(result).toContain('return state(2);');
    expect(result).toContain('"name":"count"');
    expect(result).toContain('"line":3,"column":15');
  });
  it('captures nested calls and scope member locations without changing their order', () => {
    const source = `import { scope, pipe, map, atom } from '@epikodelabs/streamix';
class App {
  model = scope({ count: 0, doubled: self => self.count * 2 });
  stream = pipe(atom(1), map(value => value * 2));
}`;
    const result = transform(source);
    expect(result).toContain('"name":"App.model.count"');
    expect(result).toContain('"name":"App.model.doubled"');
    expect(result).toContain('"kind":"derived"');
    expect(result).toContain('"line":3,"column":19');
    expect(result.indexOf('atom(1)')).toBeLessThan(result.indexOf('map(value'));
    expect(ts.createSourceFile('out.ts', result, ts.ScriptTarget.Latest, true).statements.length).toBe(3);
  });
  it('labels scope factory members and nested creation sites', () => {
    const source = `import { scope, atom } from '@epikodelabs/streamix';
const count = atom(0);
const model = scope(() => ({ count, nested: scope({ value: atom(1) }) }));`;
    const result = transform(source);
    expect(result).toContain('"name":"model.count"');
    expect(result).toContain('"name":"model.nested"');
    expect(result).toContain('"name":"model.nested.value"');
  });
  it('distinguishes event/timer sources, operators, and the resulting pipeline flow', () => {
    const source = `import { pipe, map, interval } from '@epikodelabs/streamix';
import { on } from '@epikodelabs/streamix/dom';
const viewport = pipe(on('viewportChange'), map(value => value));
const ticks = interval(1000);`;
    const result = transform(source);
    expect(result).toContain('"kind":"source","name":"on(\'viewportChange\')@');
    expect(result).toContain('"kind":"source","name":"ticks"');
    expect(result).toContain('"kind":"operator","name":"map@');
    expect(result).toContain('"kind":"flow","name":"viewport"');
  });
  it('separates component fields from method creation context and chained pipelines', () => {
    const source = `import { atom, pipe, map } from '@epikodelabs/streamix';
class App {
  viewport;
  animation;
  start() {
    this.viewport = pipe(atom(0), map(value => value)).subscribe();
    this.animation = pipe(atom(1), map(value => value)).subscribe();
    const local = atom(2);
    this.counter = atom(3);
  }
}`;
    const result = transform(source);
    expect(result).toContain('"kind":"subscription","name":"App.viewport","enclosing":"App.start","ownerClass":"App","field":"viewport"');
    expect(result).toContain('"kind":"subscription","name":"App.animation","enclosing":"App.start","ownerClass":"App","field":"animation"');
    expect(result).toContain('"kind":"flow","name":"App.pipe@');
    expect(result).not.toContain('"kind":"flow","name":"App.viewport"');
    expect(result).not.toContain('"name":"App.start.viewport"');
    expect(result).toContain('"name":"App.start.local"');
    expect(result).toContain('"name":"App.counter"');
    expect(result).toContain('__sxSubscribe(__sxDebug(pipe(');
    expect(ts.transpileModule(result, { reportDiagnostics: true }).diagnostics?.length).toBe(0);
  });
  it('leaves disabled builds byte-for-byte unchanged', () => {
    const source = `import { atom } from '@epikodelabs/streamix'; const count = atom(0);`;
    expect(transform(source, false)).toBe(source);
  });
  it('keeps factories, arguments, identity and thrown exceptions intact', () => {
    const source = `import { atom } from '@epikodelabs/streamix';
const value = atom(sideEffect());`;
    const result = transform(source).replace(/^import .*;\n/gm, '');
    const calls: string[] = [];
    const instance = {};
    const run = new Function('__sxDebug', 'atom', 'sideEffect', result + '\nreturn value;');
    expect(run((v: unknown) => { calls.push('attach'); return v; }, () => { calls.push('factory'); return instance; },
      () => { calls.push('argument'); return 1; })).toBe(instance);
    expect(calls).toEqual(['argument', 'factory', 'attach']);
    expect(() => run(() => {}, () => { throw new Error('factory failed'); }, () => 1)).toThrowError('factory failed');
  });
});

describe('introspection entry activation', () => {
  it('wraps the entry code with enable before and mount after', () => {
    const code = injectIntrospectionActivation(`import { createApp } from 'vue';\ncreateApp({}).mount('#app');`);
    expect(code).toContain("import { enableStreamixIntrospection as __sxEnable, mountStreamixInspector as __sxMount } from '@epikodelabs/streamix';");
    expect(code.indexOf('__sxEnable();')).toBeLessThan(code.indexOf('createApp'));
    expect(code.indexOf('createApp')).toBeLessThan(code.indexOf('__sxMount();'));
    // A repeated injection must not nest: the activation import is unique.
    expect(injectIntrospectionActivation(code).match(/__sxEnable\(\);/g)!.length).toBe(2);
  });
});
