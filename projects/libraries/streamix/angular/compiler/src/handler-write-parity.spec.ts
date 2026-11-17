import ts from 'typescript';
import * as vue from 'vue';
import { compileScript, parse } from '@vue/compiler-sfc';
import { atom } from '@epikodelabs/streamix';
import { useWritable } from '../../../vue/src/lib/useWritable';
import { transformVueSfc } from '../../../vue/compiler/src/compiler';
import { transformAngularComponentTemplate } from './build-transform';

describe('framework handler write parity', () => {
  it('Vue writable bridge assignments notify the original atom', () => {
    const source = atom(1);
    const emissions: number[] = [];
    const stop = source.subscribe(value => emissions.push(value));
    const result = transformVueSfc(`<script setup>
      import { atom } from '@epikodelabs/streamix';
      const count = atom(1);
    </script><template><button @click="count = count + 1">{{ count }}</button></template>`);
    expect(result.diagnostics).toEqual([]);
    const script = compileScript(parse(result.code).descriptor, { id: 'handler-parity', inlineTemplate: true }).content;
    const javascript = ts.transpileModule(script, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { default: undefined as unknown as { setup(props: object, context: object): (context: object, cache: unknown[]) => vue.VNode } };
    const require = (name: string) => {
      if (name === 'vue') return vue;
      if (name === '@epikodelabs/streamix') return { atom: () => source };
      if (name === '@epikodelabs/streamix/vue') return { useWritable };
      throw new Error(`Unexpected import: ${name}`);
    };
    new Function('require', 'exports', javascript)(require, module);
    const scope = vue.effectScope();
    try {
      const render = scope.run(() => module.default.setup({}, { expose() {} }))!;
      const cache: unknown[] = [];
      render({}, cache).props!['onClick']();
      expect(source.value).toBe(2);
      expect(emissions).toEqual([1, 2]);
      render({}, cache).props!['onClick']();
      expect(source.value).toBe(3);
      expect(emissions).toEqual([1, 2, 3]);
    } finally { scope.stop(); stop(); source.dispose(); }
  });

  it('Angular explicit source calls notify the original atom', () => {
    const source = atom(1);
    const emissions: number[] = [];
    const stop = source.subscribe(value => emissions.push(value));
    const result = transformAngularComponentTemplate('<button (click)="count.next(2)">Set</button>', 'handler.html', {
      resolveReactiveSource: path => path === 'count' ? 'count' : undefined,
    });
    const javascript = ts.transpileModule(result.setup, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    let handler!: () => void;
    const setup = new Function('createBindingTable', 'ɵsxListener', 'ɵsxInstallErrorDelivery', `${javascript}\nreturn ɵsetupSxBindings;`)(
      () => ({ destroy() {} }),
      (_table: unknown, _slot: unknown, _target: unknown, _event: unknown, callback: () => void) => handler = callback,
      () => () => {},
    );
    setup({ children: [{}] }, { count: source });
    try {
      handler();
      expect(source.value).toBe(2);
      expect(emissions).toEqual([1, 2]);
    } finally { stop(); source.dispose(); }
  });

  it('Angular rejects implicit source replacement rather than targeting a snapshot', () => {
    expect(() => transformAngularComponentTemplate('<button (click)="count = 5">Set</button>', 'handler.html', {
      resolveReactiveSource: path => path === 'count' ? 'count' : undefined,
    })).toThrowError(/Cannot assign to Streamix source/);
  });
});
