import {
  Directive,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';
import type { DependencySource } from '@epikodelabs/streamix';

import {
  bindAttribute,
  bindClass,
  bindProperty,
  bindStyle,
  bindText,
  type DirectBinding,
} from './direct-binding';

/**
 * Direct Streamix-to-DOM bindings.
 *
 * One standalone directive owns the complete scalar binding surface:
 *
 * ```html
 * <span [sx.text]="count"></span>
 * <input [sx.value]="name">
 * <button [sx.disabled]="disabled"></button>
 * <div [sx.attr.aria-label]="label"></div>
 * <div [sx.class.active]="active"></div>
 * <div [sx.style.opacity]="opacity"></div>
 * ```
 *
 * Reactive emissions write directly to the target DOM node after setup; Angular
 * does not need to walk the component view to discover what changed.
 *
 * The runtime directive exposes the common bindings below. The compiler-backed
 * renderer can lower arbitrary `[sx.<property>]`, `[sx.attr.<name>]`,
 * `[sx.class.<name>]`, and `[sx.style.<property>]` bindings directly to the
 * corresponding low-level binding primitive without adding more directives.
 */
@Directive({
  selector: '[sx\\.text],[sx\\.value],[sx\\.checked],[sx\\.disabled],[sx\\.selected],[sx\\.readOnly],[sx\\.attr\\.role],[sx\\.attr\\.title],[sx\\.attr\\.tabindex],[sx\\.attr\\.aria-label],[sx\\.attr\\.aria-hidden],[sx\\.class\\.active],[sx\\.class\\.selected],[sx\\.class\\.disabled],[sx\\.class\\.hidden],[sx\\.style\\.width],[sx\\.style\\.height],[sx\\.style\\.display],[sx\\.style\\.opacity]',
  standalone: true,
})
export class SxBindingsDirective implements OnChanges, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly bindings = new Map<string, DirectBinding>();

  @Input('sx.text')
  sxText: DependencySource<unknown> | null | undefined;

  @Input('sx.value')
  sxValue: DependencySource<unknown> | null | undefined;

  @Input('sx.checked')
  sxChecked: DependencySource<unknown> | null | undefined;

  @Input('sx.disabled')
  sxDisabled: DependencySource<unknown> | null | undefined;

  @Input('sx.selected')
  sxSelected: DependencySource<unknown> | null | undefined;

  @Input('sx.readOnly')
  sxReadOnly: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.role')
  sxAttrRole: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.title')
  sxAttrTitle: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.tabindex')
  sxAttrTabindex: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.aria-label')
  sxAttrAriaLabel: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.aria-hidden')
  sxAttrAriaHidden: DependencySource<unknown> | null | undefined;

  @Input('sx.class.active')
  sxClassActive: DependencySource<unknown> | null | undefined;

  @Input('sx.class.selected')
  sxClassSelected: DependencySource<unknown> | null | undefined;

  @Input('sx.class.disabled')
  sxClassDisabled: DependencySource<unknown> | null | undefined;

  @Input('sx.class.hidden')
  sxClassHidden: DependencySource<unknown> | null | undefined;

  @Input('sx.style.width')
  sxStyleWidth: DependencySource<unknown> | null | undefined;

  @Input('sx.style.height')
  sxStyleHeight: DependencySource<unknown> | null | undefined;

  @Input('sx.style.display')
  sxStyleDisplay: DependencySource<unknown> | null | undefined;

  @Input('sx.style.opacity')
  sxStyleOpacity: DependencySource<unknown> | null | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    this.rebind(
      changes,
      'sxText',
      'text',
      this.sxText,
      source => bindText(source, this.element.nativeElement),
      () => { this.element.nativeElement.textContent = ''; },
    );

    this.rebindProperty(changes, 'sxValue', 'value', this.sxValue);
    this.rebindProperty(changes, 'sxChecked', 'checked', this.sxChecked);
    this.rebindProperty(changes, 'sxDisabled', 'disabled', this.sxDisabled);
    this.rebindProperty(changes, 'sxSelected', 'selected', this.sxSelected);
    this.rebindProperty(changes, 'sxReadOnly', 'readOnly', this.sxReadOnly);

    this.rebindAttribute(changes, 'sxAttrRole', 'role', this.sxAttrRole);
    this.rebindAttribute(changes, 'sxAttrTitle', 'title', this.sxAttrTitle);
    this.rebindAttribute(changes, 'sxAttrTabindex', 'tabindex', this.sxAttrTabindex);
    this.rebindAttribute(changes, 'sxAttrAriaLabel', 'aria-label', this.sxAttrAriaLabel);
    this.rebindAttribute(changes, 'sxAttrAriaHidden', 'aria-hidden', this.sxAttrAriaHidden);

    this.rebindClass(changes, 'sxClassActive', 'active', this.sxClassActive);
    this.rebindClass(changes, 'sxClassSelected', 'selected', this.sxClassSelected);
    this.rebindClass(changes, 'sxClassDisabled', 'disabled', this.sxClassDisabled);
    this.rebindClass(changes, 'sxClassHidden', 'hidden', this.sxClassHidden);

    this.rebindStyle(changes, 'sxStyleWidth', 'width', this.sxStyleWidth);
    this.rebindStyle(changes, 'sxStyleHeight', 'height', this.sxStyleHeight);
    this.rebindStyle(changes, 'sxStyleDisplay', 'display', this.sxStyleDisplay);
    this.rebindStyle(changes, 'sxStyleOpacity', 'opacity', this.sxStyleOpacity);
  }

  ngOnDestroy(): void {
    for (const binding of this.bindings.values()) {
      binding.destroy();
    }
    this.bindings.clear();
  }

  private rebindProperty(
    changes: SimpleChanges,
    input: string,
    property: string,
    source: DependencySource<unknown> | null | undefined,
  ): void {
    this.rebind(
      changes,
      input,
      `property:${property}`,
      source,
      current => bindProperty(current, this.element.nativeElement, property),
    );
  }

  private rebindAttribute(
    changes: SimpleChanges,
    input: string,
    attribute: string,
    source: DependencySource<unknown> | null | undefined,
  ): void {
    this.rebind(
      changes,
      input,
      `attribute:${attribute}`,
      source,
      current => bindAttribute(current, this.element.nativeElement, attribute),
    );
  }

  private rebindClass(
    changes: SimpleChanges,
    input: string,
    className: string,
    source: DependencySource<unknown> | null | undefined,
  ): void {
    this.rebind(
      changes,
      input,
      `class:${className}`,
      source,
      current => bindClass(current, this.element.nativeElement, className),
    );
  }

  private rebindStyle(
    changes: SimpleChanges,
    input: string,
    property: string,
    source: DependencySource<unknown> | null | undefined,
  ): void {
    this.rebind(
      changes,
      input,
      `style:${property}`,
      source,
      current => bindStyle(current, this.element.nativeElement, property),
    );
  }

  private rebind(
    changes: SimpleChanges,
    input: string,
    key: string,
    source: DependencySource<unknown> | null | undefined,
    bind: (source: DependencySource<unknown>) => DirectBinding,
    clear?: () => void,
  ): void {
    if (!changes[input]) {
      return;
    }

    this.bindings.get(key)?.destroy();
    this.bindings.delete(key);

    if (!source) {
      clear?.();
      return;
    }

    this.bindings.set(key, bind(source));
  }
}
