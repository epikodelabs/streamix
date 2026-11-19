import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { atom, type Writable } from '@epikodelabs/streamix';
import { transformReactJsx } from './compiler';

function compile(handler: string) {
  const result = transformReactJsx(`
    import { atom } from '@epikodelabs/streamix';
    export let count = atom(0), other = atom(0);
    export let calls = 0;
    function nextValue() { calls++; return 5; }
    export function App() { return <button onClick={${handler}}>{count}</button>; }
  `, 'assignment-values.tsx');
  expect(result.diagnostics.filter(d => d.category === 'error')).toEqual([]);
  const javascript = ts.transpileModule(result.code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {} as {
    count: Writable<unknown>;
    other: Writable<unknown>;
    calls: number;
    App(): React.ReactElement<{ onClick(): unknown }>;
  };
  const require = (name: string) => {
    if (name === '@epikodelabs/streamix') return { atom };
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === '@epikodelabs/streamix/react') return {
      useStreamixSource: (source: Writable<unknown>) => source.value,
      useStreamixAfterCommit: () => {},
      __streamixTrace: () => {},
    };
    throw new Error(`Unexpected generated import: ${name}`);
  };
  new Function('React', 'require', 'exports', javascript)(React, require, exports);
  return exports;
}

describe('React compiler assignment expression values', () => {
  const cases = [
    { name: 'variable initializers', handler: '() => { const result = (count = nextValue()); return result; }', expected: 5, value: 5 },
    { name: 'comparisons', handler: '() => (count = "") === ""', expected: true, value: '' },
    { name: 'returned assignments', handler: '() => { return count = nextValue(); }', expected: 5, value: 5 },
    { name: 'concise event handlers', handler: '() => count = nextValue()', expected: 5, value: 5 },
    { name: 'concise nested callbacks', handler: '() => { const assign = () => count = nextValue(); return assign(); }', expected: 5, value: 5 },
    { name: 'assignment chains', handler: '() => count = other = nextValue()', expected: 5, value: 5, other: 5 },
    { name: 'statement assignments', handler: '() => { count = nextValue(); return count; }', expected: 5, value: 5 },
    { name: 'awaited assignments', handler: 'async () => count = await nextValue()', expected: 5, value: 5 },
    { name: 'awaited initializers', handler: 'async () => { const result = (count = await nextValue()); return result; }', expected: 5, value: 5 },
    { name: 'yielded assignments', handler: '() => { function* assign() { return count = yield nextValue(); } const it = assign(); const first = it.next(); return it.next(first.value).value; }', expected: 5, value: 5 },
  ];

  for (const test of cases) {
    it(`preserves ${test.name} and atom identity`, async () => {
      const module = compile(test.handler);
      const original = module.count;
      const handler = module.App().props.onClick;
      expect(await handler()).toBe(test.expected);
      expect(module.count).toBe(original);
      expect(module.count.value).toBe(test.value);
      expect(module.calls).toBe(test.name === 'comparisons' ? 0 : 1);
      if ('other' in test) expect(module.other.value).toBe(test.other);
      expect(await handler()).toBe(test.expected);
      expect(module.calls).toBe(test.name === 'comparisons' ? 0 : 2);
      module.count.dispose();
      module.other.dispose();
    });
  }

  it("keeps an awaited logical RHS lazy and returns its assigned value after a reentrant write", async () => {
    const module = compile('async () => count ||= await nextValue()');
    const subscription = module.count.subscribe(value => {
      if (value === 5) module.count.next(9);
    });
    try {
      const handler = module.App().props.onClick;
      expect(await handler()).toBe(5);
      expect(module.count.value).toBe(9);
      expect(await handler()).toBe(9);
      expect(module.calls).toBe(1);
    } finally {
      subscription();
      module.count.dispose();
      module.other.dispose();
    }
  });

  it("keeps a yielded logical RHS in the generator and skips it when the atom is non-nullish", () => {
    const module = compile(`() => {
      function* assign() { return count ??= yield nextValue(); }
      return assign();
    }`);
    try {
      const handler = module.App().props.onClick as () => Generator<unknown, unknown, unknown>;
      expect(handler().next()).toEqual({ done: true, value: 0 });
      expect(module.calls).toBe(0);
      module.count.next(null);
      const writing = handler();
      expect(writing.next()).toEqual({ done: false, value: 5 });
      expect(writing.next(7)).toEqual({ done: true, value: 7 });
      expect(module.count.value).toBe(7);
      expect(module.calls).toBe(1);
    } finally {
      module.count.dispose();
      module.other.dispose();
    }
  });
});
