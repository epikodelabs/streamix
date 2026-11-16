import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { atom, type Writable } from '@epikodelabs/streamix';
import { transformReactJsx } from './compiler';

function compileHandler(body: string, componentMap = false) {
  const result = transformReactJsx(`
    import { atom } from '@epikodelabs/streamix';
    export let count = atom(0);
    ${componentMap ? '' : 'const model = { count };'}
    export function App() {
      ${componentMap ? 'const model = { count };' : ''}
      return <button onClick={() => { ${body} }}>Run</button>;
    }
  `, 'map-shadowing.tsx');
  expect(result.diagnostics.filter(d => d.category === 'error')).toEqual([]);
  const javascript = ts.transpileModule(result.code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} as {
    count: Writable<number>;
    App(): React.ReactElement<{ onClick(): unknown }>;
  } };
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
  new Function('React', 'require', 'exports', javascript)(React, require, module.exports);
  return { code: result.code, ...module.exports };
}

describe('React compiler atom-map shadowing', () => {
  it('preserves handler-local objects on atom assignment right sides', () => {
    for (const componentMap of [false, true]) {
      const compiled = compileHandler('const model = { count: 9 }; count = model.count;', componentMap);
      expect(compiled.code).toContain('count.next(model.count)');
      compiled.App().props.onClick();
      expect(compiled.count.value).toBe(9);
      compiled.count.dispose();
    }
  });

  it('preserves parameter shadows for static and dynamic reads', () => {
    const compiled = compileHandler(`
      const key = 'count';
      count = [ { count: 9 } ].map(model => model.count + model[key])[0];
    `);
    expect(compiled.code).toContain('model.count + model[key]');
    compiled.App().props.onClick();
    expect(compiled.count.value).toBe(18);
    compiled.count.dispose();
  });

  it('preserves local map writes and reads in nested blocks', () => {
    const compiled = compileHandler(`
      { const model = { count: 9 }; model.count = 10; count = model['count']; }
    `);
    expect(compiled.code).toContain('model.count = 10');
    expect(compiled.code).toContain("count.next(model['count'])");
    compiled.App().props.onClick();
    expect(compiled.count.value).toBe(10);
    compiled.count.dispose();
  });

  it('still lowers genuine module atom-map reads and writes', () => {
    for (const componentMap of [false, true]) {
      const compiled = compileHandler('model.count = 7; count = model.count + 1;', componentMap);
      expect(compiled.code).toContain('count.next(7)');
      expect(compiled.code).toContain('count.next(count.value + 1)');
      compiled.App().props.onClick();
      expect(compiled.count.value).toBe(8);
      compiled.count.dispose();
    }
  });
});
