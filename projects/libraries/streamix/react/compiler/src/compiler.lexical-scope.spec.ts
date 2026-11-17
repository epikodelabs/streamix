import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import { atom, type Writable } from '@epikodelabs/streamix';
import { transformReactJsx } from './compiler';

function compile(expression: string, body = '') {
  const result = transformReactJsx(`
    import { atom } from '@epikodelabs/streamix';
    export const count = atom(2);
    const model = { count };
    export function App() {
      ${body}
      return <output data-local={${expression}}>{count}</output>;
    }
  `, 'lexical-scope.tsx');
  expect(result.diagnostics).toEqual([]);
  const javascript = ts.transpileModule(result.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: 'lexical-scope.tsx',
  }).outputText;
  const exports = {} as { count: Writable<number>; App(): { props: { 'data-local': unknown; children: unknown } } };
  const require = (name: string) => {
    if (name === '@epikodelabs/streamix') return { atom };
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === '@epikodelabs/streamix/react') return {
      useStreamixSource: (source: Writable<unknown>) => source.value,
      useStreamixAfterCommit: () => {}, __streamixTrace: () => {},
    };
    throw new Error(`Unexpected import: ${name}`);
  };
  new Function('require', 'exports', javascript)(require, exports);
  return { result, exports };
}

describe('React compiler lexical shadowing', () => {
  const cases = [
    { name: 'switch cases', expression: '(() => { switch (1) { case 1: const count = 5; return count; default: return 0; } })()', value: 5 },
    { name: 'default clauses', expression: '(() => { switch (1) { default: const count = 6; return count; } })()', value: 6 },
    { name: 'sibling-block var hoisting', expression: '(() => { if (true) { var count = 7; } return count; })()', value: 7 },
    { name: 'destructured var hoisting', expression: '(() => { if (true) { var { count } = { count: 8 }; } return count; })()', value: 8 },
    { name: 'var reads before initialization', expression: '(() => { const before = count; if (true) { var count = 7; } return before; })()', value: undefined },
    { name: 'class declarations', expression: '(() => { class count { static value = 9; } return count.value; })()', value: 9 },
    { name: 'named function expressions', expression: '(function count() { return typeof count; })()', value: 'function' },
    { name: 'parameter controls', expression: '((count) => count * 2)(3)', value: 6 },
  ];
  for (const test of cases) it(`preserves ${test.name} while retaining the outer subscription`, () => {
    const { result, exports } = compile(test.expression);
    expect(exports.App().props['data-local']).toBe(test.value);
    expect(exports.App().props.children).toBe(2);
    expect(result.bindingCount).toBe(1);
    exports.count.next(3);
    expect(exports.App().props['data-local']).toBe(test.value);
    expect(exports.App().props.children).toBe(3);
    exports.count.dispose();
  });

  for (const [name, body] of [
    ['nested functions', 'function unrelated() { var count = 99; return count; }'],
    ['lexical blocks', 'if (true) { let count = 99; }'],
    ['class static blocks', 'class Local { static { var count = 99; } }'],
  ]) it(`does not hoist ${name} over a genuine atom read`, () => {
    const { exports } = compile(`(() => { ${body} return ({ count: count }).count; })()`);
    expect(exports.App().props['data-local']).toBe(2);
    exports.count.next(3);
    expect(exports.App().props['data-local']).toBe(3);
    exports.count.dispose();
  });

  it('resolves hoisted component locals and component-level class declarations', () => {
    const hoisted = compile('count', 'if (true) { var count = 7; }');
    expect(hoisted.exports.App().props['data-local']).toBe(7);
    expect(hoisted.result.bindingCount).toBe(0);
    hoisted.exports.count.dispose();
    const destructured = compile('count', 'if (true) { var { count } = { count: 9 }; }');
    expect(destructured.exports.App().props['data-local']).toBe(9);
    expect(destructured.result.bindingCount).toBe(0);
    destructured.exports.count.dispose();
    const localClass = compile('count.value', 'class count { static value = 8; }');
    expect(localClass.exports.App().props['data-local']).toBe(8);
    expect(localClass.result.bindingCount).toBe(0);
    localClass.exports.count.dispose();
  });

  it('resolves a hoisted plain object instead of a module atom map', () => {
    const { result, exports } = compile('model.count', 'if (true) { var model = { count: 7 }; }');
    expect(exports.App().props['data-local']).toBe(7);
    expect(exports.App().props.children).toBe(2);
    expect(result.bindingCount).toBe(1);
    exports.count.dispose();
  });
});
