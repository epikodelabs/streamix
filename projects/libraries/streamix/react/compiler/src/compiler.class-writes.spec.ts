import { transformReactJsx } from './compiler';

function compile(handler: string) {
  return transformReactJsx(`
    import * as React from 'react';
    import { atom } from '@epikodelabs/streamix';
    let count = atom(0);
    const model = { count };
    export class App extends React.Component {
      render() { return <button onClick={() => { ${handler}; }}>{count}</button>; }
    }
  `, 'class-writes.tsx');
}

describe('React class-component atom writes', () => {
  for (const write of ['count = 5', 'count += 1', 'count ||= 5', 'count++', '--count',
    'count.value = 5', 'model.count = 5', '({ count } = { count: 5 })']) {
    it(`diagnoses ${write} without writing a snapshot`, () => {
      const result = compile(write);
      const errors = result.diagnostics.filter(d => d.category === 'error');
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('count.next(value)');
      expect(result.code).not.toMatch(/__streamixBindings\["count"\]\s*(?:=|\+=|\|\|=|\+\+|--)/);
    });
  }

  it('preserves an explicit source method while rewriting its read argument', () => {
    const result = compile('count.next(count + 1)');
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('count.next(');
    expect(result.code).not.toContain('__streamixBindings["count"].next');
  });

  it('keeps explicit value reads subscribed through class snapshots', () => {
    const result = transformReactJsx(`let count = atom(0); class App extends React.Component {
      render() { return <output>{count.value}</output>; }
    }`);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('useStreamixSource(count, "count")');
    expect(result.code).toContain('__streamixBindings["count"]');
  });

  it('preserves shadowed local assignments and still bridges class reads', () => {
    const result = compile('let count = 0; count = 5; count++');
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('count = 5');
    expect(result.code).toContain('count++');
    expect(result.code).toContain('__streamixBindings["count"]');
  });

  it('leaves supported function-component writes on their lowering path', () => {
    const result = transformReactJsx(`let count = atom(0); function App() {
      return <button onClick={() => { count = 5; count++; }}>{count}</button>;
    }`);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('count.next(5)');
  });

  it('diagnoses write-only handlers and separate class methods', () => {
    const result = transformReactJsx(`let count = atom(0); class App extends React.Component {
      update = () => { count = 5; };
      render() { return <button onClick={this.update}>Set</button>; }
    }`);
    expect(result.diagnostics.filter(d => d.category === 'error').length).toBe(1);
    expect(result.code).toContain('count = 5');
  });

  it('preserves loop assignment targets and reports implicit atom writes', () => {
    const result = compile('for (count of [1, 2]) {}');
    expect(result.diagnostics.filter(d => d.category === 'error').length).toBe(1);
    expect(result.code).toContain('for (count of [1, 2])');
  });

  it('preserves ordinary scope property writes', () => {
    const result = transformReactJsx(`const state = scope({ count: 0 }); class App extends React.Component {
      render() { return <button onClick={() => { state.count = state.count + 1; }}>{state.count}</button>; }
    }`);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('state.count =');
    expect(result.code).not.toMatch(/__streamixBindings\["state.count"\]\s*=/);
  });
});
