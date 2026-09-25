import { atom } from '@epikodelabs/streamix';
import * as sxAngular from '../lib';

import {
  emitComponentModule,
} from '../compiler/emit-component-module';
import {
  createSxStructuralPlanEntry,
} from '../compiler/sx-parser';
import {
  emitStructuralModule,
} from '../compiler/emit-structural-module';
import {
  transformSxTemplate,
} from '../compiler/template-transform';

const RUNTIME_IMPORT =
  /import\s*\{([^}]+)\}\s*from\s+(['"])@epikodelabs\/streamix\/angular\2;/;

/**
 * Executes a generated setup function against the real runtime exports.
 *
 * The emitted modules are TypeScript, but the only type syntax is the fixed
 * `(host: Element, ctx: any)` signature plus `as Element` casts, so the known
 * signature line can be swapped for an untyped one and the body evaluated
 * with the runtime barrel's actual functions injected as parameters.
 */
function compileEmittedSetup(
  moduleText: string,
  functionName: string,
): (host: Element, ctx: unknown) => { destroy(): void } {
  const importMatch = RUNTIME_IMPORT.exec(moduleText);

  expect(importMatch).not.toBeNull();

  const names = importMatch![1]
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);

  const runtime = sxAngular as unknown as Record<string, unknown>;
  const missing = names.filter(name => runtime[name] === undefined);

  expect(missing).toEqual([]);

  const signature =
    `export function ${functionName}(host: Element, ctx: any) {`;
  const start = moduleText.indexOf(signature);

  expect(start).toBeGreaterThanOrEqual(0);

  const body = moduleText
    .slice(start + signature.length, moduleText.trimEnd().lastIndexOf('}'))
    .replaceAll(' as Element', '');

  return new Function(
    ...names,
    `return function (host, ctx) {\n${body}\n};`,
  )(...names.map(name => runtime[name])) as
    (host: Element, ctx: unknown) => { destroy(): void };
}

idescribe('compiler/runtime contract', () => {
  it('executes the emitted direct-binding module against the real runtime', () => {
    const result = transformSxTemplate(`
      <section>
        <span [sx.text]="count"></span>
        <button
          [sx.disabled]="disabled"
          [sx.attr.aria-label]="label"
          [sx.class.active]="active"
          [sx.style.opacity]="opacity">
          Save
        </button>
      </section>
    `);

    const host = document.createElement('div');
    host.innerHTML = result.template;

    const count = atom(0);
    const disabled = atom(false);
    const label = atom<unknown>('Details');
    const active = atom(false);
    const opacity = atom<unknown>('0.5');

    const setup = compileEmittedSetup(
      emitComponentModule(result.parsed),
      'ɵsetupSxBindings',
    );
    const teardown = setup(host, { count, disabled, label, active, opacity });

    const section = host.children[0] as Element;
    const span = section.children[0] as Element;
    const button = section.children[1] as HTMLButtonElement;

    // The emitted node paths point at the DOM the transformed template
    // produces, and initial values are written synchronously.
    expect(span.textContent).toBe('0');
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-label')).toBe('Details');
    expect(button.classList.contains('active')).toBeFalse();
    expect(button.style.opacity).toBe('0.5');

    count.set(7);
    disabled.set(true);
    label.set(null);
    active.set(true);
    opacity.set('1');

    sxAngular.rendererScheduler.flushNow();

    expect(span.textContent).toBe('7');
    expect(button.disabled).toBeTrue();
    expect(button.hasAttribute('aria-label')).toBeFalse();
    expect(button.classList.contains('active')).toBeTrue();
    expect(button.style.opacity).toBe('1');

    teardown.destroy();
  });

  it('executes the emitted structural module against the real runtime', () => {
    const plan = {
      blocks: [
        createSxStructuralPlanEntry(0, 'user as user', '<p>{{ user }}</p>'),
        createSxStructuralPlanEntry(
          1,
          'let hero of heroes',
          '<li>Hello {{ hero }}</li>',
        ),
      ],
    };

    const host = document.createElement('section');

    const user = atom<string | undefined>('Ada');
    const heroes = atom(['a', 'b']);

    const setup = compileEmittedSetup(
      emitStructuralModule(plan),
      'ɵsetupSxStructuralBlocks',
    );
    const teardown = setup(host, { user, heroes });

    // Value block renders synchronously after the anchor comment.
    const paragraph = host.querySelector('p');
    expect(paragraph?.textContent).toBe('Ada');

    // Keyed block renders one DOM range per item, keyed by identity.
    const items = () => Array.from(host.querySelectorAll('li'))
      .map(li => li.textContent);

    expect(items()).toEqual(['Hello a', 'Hello b']);

    const [itemA, itemB] = Array.from(host.querySelectorAll('li'));

    user.set('Grace');
    heroes.set(['b', 'a']);

    sxAngular.rendererScheduler.flushNow();

    expect(paragraph?.textContent).toBe('Grace');

    // The same DOM nodes are reused and moved, not recreated.
    const reordered = Array.from(host.querySelectorAll('li'));

    expect(items()).toEqual(['Hello b', 'Hello a']);
    expect(reordered[0]).toBe(itemB);
    expect(reordered[1]).toBe(itemA);

    heroes.set(['b']);
    sxAngular.rendererScheduler.flushNow();

    expect(items()).toEqual(['Hello b']);
    expect(host.querySelector('li')).toBe(itemB);

    teardown.destroy();
  });
});
import { idescribe } from '../../../src/tests/env.spec';
