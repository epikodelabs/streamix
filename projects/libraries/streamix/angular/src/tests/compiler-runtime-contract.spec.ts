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
): (host: Element, ctx: unknown, invalidate?: () => void) => { destroy(): void } {
  const importMatch = RUNTIME_IMPORT.exec(moduleText);

  expect(importMatch).not.toBeNull();

  const names = importMatch![1]
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);

  const runtime = sxAngular as unknown as Record<string, unknown>;
  const missing = names.filter(name => runtime[name] === undefined);

  expect(missing).toEqual([]);

  const signature = `export function ${functionName}(`;
  const start = moduleText.indexOf(signature);

  expect(start).toBeGreaterThanOrEqual(0);

  // The setup signature contains callback types/defaults such as
  // `() => {}`. Do not treat a brace from the parameter list as the
  // function body. Generated setup functions always terminate the signature
  // with a standalone `) {` line.
  const bodyMarker = '\n) {';
  const bodyMarkerStart = moduleText.indexOf(bodyMarker, start);
  expect(bodyMarkerStart).toBeGreaterThan(start);
  const bodyStart = bodyMarkerStart + bodyMarker.length - 1;

  const body = moduleText
    .slice(bodyStart + 1, moduleText.trimEnd().lastIndexOf('}'))
    .replaceAll(' as Element', '');

  return new Function(
    ...names,
    `return function (host, ctx, invalidate = () => {}) {\n${body}\n};`,
  )(...names.map(name => runtime[name])) as
    (host: Element, ctx: unknown, invalidate?: () => void) => { destroy(): void };
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

  it('executes automatic .value text and native bindings without Angular CD', () => {
    const result = transformSxTemplate(`
      <section>
        <span>{{ count.value }}</span>
        <strong>{{ count.value * 2 }}</strong>
        <button
          [disabled]="disabled.value"
          [attr.aria-label]="label.value"
          [class.active]="active.value"
          [style.opacity]="opacity.value">
          Save
        </button>
      </section>
    `);

    const host = document.createElement('div');
    host.innerHTML = result.template;

    const sectionBefore = host.children[0] as Element;
    const spanTextNode = sectionBefore.children[0].firstChild;
    const strongTextNode = sectionBefore.children[1].firstChild;

    const count = atom(2);
    const disabled = atom(false);
    const label = atom<unknown>('Details');
    const active = atom(false);
    const opacity = atom<unknown>('0.5');

    const setup = compileEmittedSetup(
      emitComponentModule(result.parsed),
      'ɵsetupSxBindings',
    );
    const teardown = setup(host, {
      count,
      disabled,
      label,
      active,
      opacity,
    });

    const section = host.children[0] as Element;
    const span = section.children[0] as Element;
    const strong = section.children[1] as Element;
    const button = section.children[2] as HTMLButtonElement;

    expect(span.textContent).toBe('2');
    expect(strong.textContent).toBe('4');
    expect(span.firstChild).toBe(spanTextNode);
    expect(strong.firstChild).toBe(strongTextNode);
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-label')).toBe('Details');
    expect(button.classList.contains('active')).toBeFalse();
    expect(button.style.opacity).toBe('0.5');

    count.set(3);
    disabled.set(true);
    label.set(null);
    active.set(true);
    opacity.set('1');

    sxAngular.rendererScheduler.flushNow();

    expect(span.textContent).toBe('3');
    expect(strong.textContent).toBe('6');
    expect(span.firstChild).toBe(spanTextNode);
    expect(strong.firstChild).toBe(strongTextNode);
    expect(button.disabled).toBeTrue();
    expect(button.hasAttribute('aria-label')).toBeFalse();
    expect(button.classList.contains('active')).toBeTrue();
    expect(button.style.opacity).toBe('1');

    teardown.destroy();
  });


  it('executes source-transparent bindings with direct runtime ownership', () => {
    const sources = new Set(['count', 'disabled', 'label', 'active', 'opacity']);
    const result = transformSxTemplate(`
      <section>
        <span>{{ count }}</span>
        <strong>{{ count * 2 }}</strong>
        <button
          [disabled]="disabled"
          [attr.aria-label]="label"
          [class.active]="active"
          [style.opacity]="opacity">
          Save
        </button>
      </section>
    `, 'inline.html', {
      isDependencySource: path => sources.has(path),
    });

    expect(result.template).toContain('{{ count.value }}');
    expect(result.template).toContain('{{ count.value * 2 }}');
    expect(result.template).toContain('[disabled]="disabled.value"');

    const host = document.createElement('div');
    host.innerHTML = result.template;

    const count = atom(2);
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
    const strong = section.children[1] as Element;
    const button = section.children[2] as HTMLButtonElement;

    expect(span.textContent).toBe('2');
    expect(strong.textContent).toBe('4');
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-label')).toBe('Details');
    expect(button.classList.contains('active')).toBeFalse();
    expect(button.style.opacity).toBe('0.5');

    count.set(4);
    disabled.set(true);
    label.set('Busy');
    active.set(true);
    opacity.set('1');

    sxAngular.rendererScheduler.flushNow();

    expect(span.textContent).toBe('4');
    expect(strong.textContent).toBe('8');
    expect(button.disabled).toBeTrue();
    expect(button.getAttribute('aria-label')).toBe('Busy');
    expect(button.classList.contains('active')).toBeTrue();
    expect(button.style.opacity).toBe('1');

    teardown.destroy();
  });

  it('coalesces hybrid interpolation into one Angular view invalidation', () => {
    const result = transformSxTemplate(`
      <section>
        <span>{{ count.value * multiplier }}</span>
        <span>{{ price.value + suffix }}</span>
      </section>
    `);

    // Hybrid expressions stay in Angular's template; only invalidation is
    // compiler-generated.
    expect(result.template).toContain('{{ count.value * multiplier }}');
    expect(result.template).toContain('{{ price.value + suffix }}');

    const host = document.createElement('div');
    host.innerHTML = '<section><span></span><span></span></section>';

    const count = atom(1);
    const price = atom(2);
    let invalidations = 0;

    const setup = compileEmittedSetup(
      emitComponentModule(result.parsed),
      'ɵsetupSxBindings',
    );
    const teardown = setup(
      host,
      { count, price, multiplier: 3, suffix: '!' },
      () => { invalidations += 1; },
    );

    count.set(2);
    price.set(4);
    count.set(3);

    sxAngular.rendererScheduler.flushNow();

    expect(invalidations).toBe(1);

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
