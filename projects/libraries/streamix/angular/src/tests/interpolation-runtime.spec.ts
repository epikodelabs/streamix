import ts from 'typescript';
import { atom, scope, type Writable } from '@epikodelabs/streamix';
import { transformAngularComponentTemplate } from '../../compiler/src/build-transform';
import type { SxReactiveSourceResolver } from '../../compiler/src/source-resolution';
import * as instructions from '../lib/binding-table';
import * as blockInstructions from '../lib/structural-block';
import { ɵsxInstallErrorDelivery } from '../lib/error-delivery';
import { ɵsxFindTarget } from '../lib/compiled-block-helpers';
import { ɵdestroySxResources } from '../lib/block-construction';
import { rendererScheduler } from '../lib/render-scheduler';
import { idescribe } from '../../../src/tests/env.spec';

function install(template: string, host: Element, context: object, resolve?: SxReactiveSourceResolver) {
  const result = transformAngularComponentTemplate(template, 'test.html', {
    resolveReactiveSource: resolve ?? (path => path === 'model.rate' ? "model.get('rate')"
      : path === 'model.ready' ? "model.get('ready')"
      : ['count', 'other'].includes(path) ? path : undefined),
  });
  const javascript = ts.transpileModule(result.setup, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const setup = new Function(
    ...Object.keys(instructions), ...Object.keys(blockInstructions),
    'ɵsxInstallErrorDelivery', 'ɵsxFindTarget', 'ɵdestroySxResources',
    javascript + '\nreturn ɵsetupSxBindings;',
  )(
    ...Object.values(instructions), ...Object.values(blockInstructions),
    ɵsxInstallErrorDelivery, ɵsxFindTarget, ɵdestroySxResources,
  );
  return setup(host, context) as { destroy(): void };
}

idescribe('compiled interpolation DOM updates', () => {
  it('updates object value fields that share names with source APIs', () => {
    const form = atom({ error: 'bad' });
    const host = document.createElement('div');
    host.innerHTML = '<p>server</p>';
    const resolver: SxReactiveSourceResolver = path => path === 'form' ? path : undefined;
    resolver.hasValueMember = (path, name) => path === 'form' && name === 'error';
    const binding = install('<p>{{ form.error }}</p>', host, { form }, resolver);
    try {
      expect(host.textContent).toBe('bad');
      form.next({ error: 'fixed' });
      rendererScheduler.flushNow();
      expect(host.textContent).toBe('fixed');
    } finally {
      binding.destroy();
      form.dispose();
    }
  });
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


  it('addresses interpolations across flattened ng-container text', () => {
    const host = document.createElement('div');
    // Angular flattens ng-container content into the parent: the rendered DOM
    // carries the container's text node before the interpolation's own node.
    host.innerHTML = '<p>prefix <!--anchor-->2</p>';
    const paragraph = host.firstElementChild!;
    const count = atom(2);
    const binding = install(
      '<p><ng-container>prefix </ng-container>{{ count }}</p>',
      host, { count },
    );
    try {
      expect(paragraph.textContent).toBe('prefix 2');
      count.set(5);
      rendererScheduler.flushNow();
      expect(paragraph.textContent).toBe('prefix 5');
      // The static prefix keeps its own text node identity.
      expect(paragraph.firstChild!.textContent).toBe('prefix ');
    } finally {
      binding.destroy();
      count.dispose();
    }
  });

  it('addresses interpolations after dynamic siblings through compiler markers', () => {
    const template = '<p>@if (model.ready) { <b>started</b> } {{ count }}</p>';
    const result = transformAngularComponentTemplate(template, 'test.html', {
      resolveReactiveSource: path => path === 'model.ready' ? "model.get('ready')"
        : path === 'count' ? 'count' : undefined,
    });
    const host = document.createElement('div');
    // The transformed template is what Angular renders, markers included.
    host.innerHTML = result.template;
    const paragraph = host.firstElementChild!;
    const count = atom(2);
    const model = scope(() => ({ ready: atom<boolean>(true) }));
    const binding = install(template, host, { count, model });
    try {
      // Authored whitespace runs survive verbatim; normalize for clarity.
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
      expect(normalize(paragraph.textContent!)).toBe('started 2');
      expect(normalize(paragraph.querySelector('b')!.textContent!)).toBe('started');
      const interpolation = paragraph.querySelector('[data-sx-node]')!;
      expect(normalize(interpolation.textContent!)).toBe('2');

      count.set(9);
      rendererScheduler.flushNow();
      expect(normalize(interpolation.textContent!)).toBe('9');

      // The dynamic sibling swaps its content while the interpolation keeps
      // its own node: no text-node index shifts.
      (model.get('ready') as Writable<boolean>).set(false);
      rendererScheduler.flushNow();
      expect(normalize(paragraph.textContent!)).toBe('9');
      expect(normalize(interpolation.textContent!)).toBe('9');
    } finally {
      binding.destroy();
      count.dispose();
      model.dispose();
    }
  });
});

