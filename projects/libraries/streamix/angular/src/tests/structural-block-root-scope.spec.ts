import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';
import {
  TestBed,
} from '@angular/core/testing';
import { atom } from '@epikodelabs/streamix';

import {
  createBindingTable,
  rendererScheduler,
  ɵcreateSxConditionalBlock,
  ɵinstallSxCompiledView,
  ɵsxBlockAnchor,
} from '../lib';

import { idescribe } from '../../../src/tests/env.spec';
import {
  ensureAngularTestEnvironment,
  useAngularTestEnvironment,
} from './angular-test-environment';

ensureAngularTestEnvironment();

/**
 * Simulates the compiler output for a component whose whole template is one
 * lowered `@if` block: the marker element is the template root, so the block
 * anchor's parent is the component host, not a template element.
 */
@Component({
  standalone: true,
  selector: 'sx-root-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.Emulated,
  template: '<span data-sx-block="0"></span>',
  styles: ['.card[_ngcontent-%COMP%] { color: rgb(9, 8, 7); }'],
})
class RootBlockComponent {
  readonly visible = atom(true);

  readonly ɵsx = ɵinstallSxCompiledView(
    this,
    (host: Element, _ctx: RootBlockComponent, server = false) => {
      const table = createBindingTable(0);
      const marker0 = host.querySelector('[data-sx-block="0"]') as Element;
      const anchor0 = ɵsxBlockAnchor(marker0, 'sx:0', server);

      const block0 = ɵcreateSxConditionalBlock(anchor0, [
        {
          source: this.visible,
          factory: () => {
            const doc = host.ownerDocument!;
            const el0 = doc.createElement('div');
            el0.setAttribute('class', 'card');
            el0.appendChild(doc.createTextNode('inside'));

            return {
              first: el0,
              last: el0,
              destroy() {},
            };
          },
        },
        {
          source: null,
          factory: () => {
            const doc = host.ownerDocument!;
            const el1 = doc.createElement('div');

            return {
              first: el1,
              last: el1,
              destroy() {},
            };
          },
        },
      ]);

      return {
        destroy() {
          table.destroy();
          block0.destroy();
        },
      };
    },
  );
}

@Component({
  standalone: true,
  selector: 'sx-parent-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.Emulated,
  imports: [RootBlockComponent],
  template:
    '<span class="parent-marker"></span><sx-root-block></sx-root-block>',
  styles: ['.card[_ngcontent-%COMP%] { background-color: rgb(1, 2, 3); }'],
})
class ParentHostComponent {}

function contentAttributesOf(element: Element): string[] {
  return element
    .getAttributeNames()
    .filter(name => name.startsWith('_ngcontent-'));
}

idescribe('template-root structural block content scoping', () => {
  useAngularTestEnvironment();

  it('applies the component content scope to a template-root block', async () => {
    const fixture = TestBed.createComponent(RootBlockComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = fixture.nativeElement.querySelector('.card') as Element;
    expect(card).toBeDefined();
    expect(card.textContent).toBe('inside');

    // The block elements are direct DOM: they need the component's own
    // _ngcontent attribute for component-scoped styles to match.
    const attributes = contentAttributesOf(card);
    expect(attributes.length).toBe(1);
    expect(getComputedStyle(card).color).toBe('rgb(9, 8, 7)');

    fixture.detectChanges();
    rendererScheduler.flushNow();
    fixture.destroy();
  });

  it('does not leak the parent scope into a nested template-root block', async () => {
    const fixture = TestBed.createComponent(ParentHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = fixture.nativeElement.querySelector('.card') as Element;
    expect(card).toBeDefined();

    const attributes = contentAttributesOf(card);
    expect(attributes.length).toBe(1);
    expect(attributes[0]).not.toBe(
      contentAttributesOf(
        fixture.nativeElement.querySelector('.parent-marker')!,
      )[0],
    );

    // The parent's scoped .card rule must not match; the child's own scoped
    // rule must.
    expect(getComputedStyle(card).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(card).color).toBe('rgb(9, 8, 7)');

    fixture.detectChanges();
    rendererScheduler.flushNow();
    fixture.destroy();
  });
});
