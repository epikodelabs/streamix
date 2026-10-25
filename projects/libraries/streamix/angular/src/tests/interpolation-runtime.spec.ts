import ts from 'typescript';
import { atom, scope } from '@epikodelabs/streamix';
import { transformAngularComponentTemplate } from '../../compiler/src/build-transform';
import * as instructions from '../lib/binding-table';
import { rendererScheduler } from '../lib/render-scheduler';
import { idescribe } from '../../../src/tests/env.spec';

function install(template: string, host: Element, context: object) {
  const result = transformAngularComponentTemplate(template, 'test.html', {
    resolveReactiveSource: path => path === 'model.rate' ? "model.get('rate')"
      : ['count', 'other'].includes(path) ? path : undefined,
  });
  const javascript = ts.transpileModule(result.setup, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const setup = new Function(...Object.keys(instructions), javascript + '\nreturn ɵsetupSxBindings;')(
    ...Object.values(instructions),
  );
  return setup(host, context) as { destroy(): void };
}

idescribe('compiled interpolation DOM updates', () => {
  it('samples plain state on emissions and preserves sibling DOM identities', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p>initial<strong>fixed</strong>initial</p>';
    const paragraph = host.firstElementChild!;
    const firstText = paragraph.firstChild;
    const strong = paragraph.querySelector('strong');
    const lastText = paragraph.lastChild;
    const count = atom(2);
    const other = atom(3);
    const context = { count, other, multiplier: 3, label: 'Count' };
    const binding = install(
      '<p title="{{ label }}: {{ count }}">{{ count * multiplier }}<strong>fixed</strong>{{ label }} {{ other }}</p>',
      host, context,
    );
    try {
      expect(paragraph.textContent).toBe('6fixedCount 3');
      expect(paragraph.getAttribute('title')).toBe('Count: 2');
      context.multiplier = 4;
      context.label = 'Total';
      rendererScheduler.flushNow();
      expect(paragraph.textContent).toBe('6fixedCount 3');
      count.set(5);
      rendererScheduler.flushNow();
      expect(paragraph.textContent).toBe('20fixedCount 3');
      expect(paragraph.getAttribute('title')).toBe('Total: 5');
      other.set(7);
      rendererScheduler.flushNow();
      expect(paragraph.textContent).toBe('20fixedTotal 7');
      expect(paragraph.firstChild).toBe(firstText);
      expect(paragraph.lastChild).toBe(lastText);
      expect(paragraph.querySelector('strong')).toBe(strong);
    } finally {
      binding.destroy();
      count.dispose();
      other.dispose();
    }
  });

  it('renders nullish values as empty strings in combined runs', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p>initial</p>';
    const count = atom<string | null>(null);
    const binding = install('<p>before {{ count }} after</p>', host, { count });
    try {
      expect(host.textContent).toBe('before  after');
      count.set('value');
      rendererScheduler.flushNow();
      expect(host.textContent).toBe('before value after');
    } finally {
      binding.destroy();
      count.dispose();
    }
  });
});

idescribe('standalone/scoped/plain interpolation emissions', () => {
  it('samples variables on either atom emission and stops updating after teardown', () => {
    const count = atom(2);
    const model = scope({ rate: 3 });
    const context = { count, model, multiplier: 5 };
    const host = document.createElement('div');
    host.innerHTML = '<p title="server">server</p>';
    const paragraph = host.firstElementChild!;
    const binding = install(
      '<p title="{{ count }} / {{ model.rate }} / {{ multiplier }}">{{ count * model.rate * multiplier }}</p>',
      host, context,
    );
    try {
      expect(paragraph.textContent).toBe('30');
      expect(paragraph.getAttribute('title')).toBe('2 / 3 / 5');
      context.multiplier = 7;
      rendererScheduler.flushNow();
      expect(paragraph.textContent).toBe('30');
      count.set(4);
      rendererScheduler.flushNow();
      expect(paragraph.textContent).toBe('84');
      expect(paragraph.getAttribute('title')).toBe('4 / 3 / 7');
      model.rate = 6;
      rendererScheduler.flushNow();
      expect(paragraph.textContent).toBe('168');
      expect(paragraph.getAttribute('title')).toBe('4 / 6 / 7');
      binding.destroy();
      count.set(10);
      model.rate = 10;
      rendererScheduler.flushNow();
      expect(paragraph.textContent).toBe('168');
      expect(paragraph.getAttribute('title')).toBe('4 / 6 / 7');
    } finally {
      binding.destroy();
      count.dispose();
      model.dispose();
    }
  });
});
