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

import { ɵinstallSxAngularZone } from './angular-zone';
import {
  bindAttribute,
  bindClass,
  bindProperty,
  bindStyle,
  type DirectBinding,
} from './direct-binding';

/**
 * Direct DOM property bindings.
 *
 * Public template syntax:
 *
 * ```html
 * <input [sx.value]="name">
 * <input [sx.checked]="checked">
 * <button [sx.disabled]="disabled">Save</button>
 * ```
 *
 * Each binding writes directly to the corresponding DOM property after setup.
 *
 * This initial runtime entry point provides the most common properties. The
 * compiler-backed renderer can later lower arbitrary `[sx.<property>]`
 * bindings directly to `bindProperty(...)` without growing this directive.
 */
@Directive({
  selector:
    '[sx\\.value],[sx\\.checked],[sx\\.disabled],[sx\\.selected],[sx\\.readOnly]',
  standalone: true,
})
export class SxPropertyBindingsDirective implements OnChanges, OnDestroy {
  constructor() {
    ɵinstallSxAngularZone();
  }

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly bindings = new Map<string, DirectBinding>();

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

  ngOnChanges(changes: SimpleChanges): void {
    this.rebindProperty(changes, 'sxValue', 'value', this.sxValue);
    this.rebindProperty(changes, 'sxChecked', 'checked', this.sxChecked);
    this.rebindProperty(changes, 'sxDisabled', 'disabled', this.sxDisabled);
    this.rebindProperty(changes, 'sxSelected', 'selected', this.sxSelected);
    this.rebindProperty(changes, 'sxReadOnly', 'readOnly', this.sxReadOnly);
  }

  ngOnDestroy(): void {
    this.destroyAll();
  }

  private rebindProperty(
    changes: SimpleChanges,
    input: string,
    property: string,
    source: DependencySource<unknown> | null | undefined,
  ): void {
    if (!changes[input]) {
      return;
    }

    this.bindings.get(property)?.destroy();
    this.bindings.delete(property);

    if (!source) {
      return;
    }

    this.bindings.set(
      property,
      bindProperty(source, this.element.nativeElement, property),
    );
  }

  private destroyAll(): void {
    for (const binding of this.bindings.values()) {
      binding.destroy();
    }
    this.bindings.clear();
  }
}

/**
 * Direct attribute bindings.
 *
 * Initial runtime aliases cover common attributes. The compiler path is
 * designed to support arbitrary `[sx.attr.<name>]`.
 */
@Directive({
  selector:
    '[sx\\.attr\\.role],[sx\\.attr\\.title],[sx\\.attr\\.tabindex],[sx\\.attr\\.aria-label],[sx\\.attr\\.aria-hidden]',
  standalone: true,
})
export class SxAttributeBindingsDirective implements OnChanges, OnDestroy {
  constructor() {
    ɵinstallSxAngularZone();
  }

  private readonly element = inject<ElementRef<Element>>(ElementRef);
  private readonly bindings = new Map<string, DirectBinding>();

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

  ngOnChanges(changes: SimpleChanges): void {
    this.rebind(changes, 'sxAttrRole', 'role', this.sxAttrRole);
    this.rebind(changes, 'sxAttrTitle', 'title', this.sxAttrTitle);
    this.rebind(changes, 'sxAttrTabindex', 'tabindex', this.sxAttrTabindex);
    this.rebind(changes, 'sxAttrAriaLabel', 'aria-label', this.sxAttrAriaLabel);
    this.rebind(changes, 'sxAttrAriaHidden', 'aria-hidden', this.sxAttrAriaHidden);
  }

  ngOnDestroy(): void {
    for (const binding of this.bindings.values()) {
      binding.destroy();
    }
    this.bindings.clear();
  }

  private rebind(
    changes: SimpleChanges,
    input: string,
    attribute: string,
    source: DependencySource<unknown> | null | undefined,
  ): void {
    if (!changes[input]) {
      return;
    }

    this.bindings.get(attribute)?.destroy();
    this.bindings.delete(attribute);

    if (!source) {
      return;
    }

    this.bindings.set(
      attribute,
      bindAttribute(source, this.element.nativeElement, attribute),
    );
  }
}

/**
 * Direct class bindings.
 *
 * The runtime provides common aliases while the compiler path supports
 * arbitrary `[sx.class.<name>]`.
 */
@Directive({
  selector:
    '[sx\\.class\\.active],[sx\\.class\\.selected],[sx\\.class\\.disabled],[sx\\.class\\.hidden]',
  standalone: true,
})
export class SxClassBindingsDirective implements OnChanges, OnDestroy {
  constructor() {
    ɵinstallSxAngularZone();
  }

  private readonly element = inject<ElementRef<Element>>(ElementRef);
  private readonly bindings = new Map<string, DirectBinding>();

  @Input('sx.class.active')
  sxClassActive: DependencySource<unknown> | null | undefined;

  @Input('sx.class.selected')
  sxClassSelected: DependencySource<unknown> | null | undefined;

  @Input('sx.class.disabled')
  sxClassDisabled: DependencySource<unknown> | null | undefined;

  @Input('sx.class.hidden')
  sxClassHidden: DependencySource<unknown> | null | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    this.rebind(changes, 'sxClassActive', 'active', this.sxClassActive);
    this.rebind(changes, 'sxClassSelected', 'selected', this.sxClassSelected);
    this.rebind(changes, 'sxClassDisabled', 'disabled', this.sxClassDisabled);
    this.rebind(changes, 'sxClassHidden', 'hidden', this.sxClassHidden);
  }

  ngOnDestroy(): void {
    for (const binding of this.bindings.values()) {
      binding.destroy();
    }
    this.bindings.clear();
  }

  private rebind(
    changes: SimpleChanges,
    input: string,
    className: string,
    source: DependencySource<unknown> | null | undefined,
  ): void {
    if (!changes[input]) {
      return;
    }

    this.bindings.get(className)?.destroy();
    this.bindings.delete(className);

    if (!source) {
      return;
    }

    this.bindings.set(
      className,
      bindClass(source, this.element.nativeElement, className),
    );
  }
}

/**
 * Direct style bindings.
 *
 * The runtime covers common properties while the compiler path supports
 * arbitrary `[sx.style.<property>]`.
 */
@Directive({
  selector:
    '[sx\\.style\\.width],[sx\\.style\\.height],[sx\\.style\\.display],[sx\\.style\\.opacity]',
  standalone: true,
})
export class SxStyleBindingsDirective implements OnChanges, OnDestroy {
  constructor() {
    ɵinstallSxAngularZone();
  }

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly bindings = new Map<string, DirectBinding>();

  @Input('sx.style.width')
  sxStyleWidth: DependencySource<unknown> | null | undefined;

  @Input('sx.style.height')
  sxStyleHeight: DependencySource<unknown> | null | undefined;

  @Input('sx.style.display')
  sxStyleDisplay: DependencySource<unknown> | null | undefined;

  @Input('sx.style.opacity')
  sxStyleOpacity: DependencySource<unknown> | null | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    this.rebind(changes, 'sxStyleWidth', 'width', this.sxStyleWidth);
    this.rebind(changes, 'sxStyleHeight', 'height', this.sxStyleHeight);
    this.rebind(changes, 'sxStyleDisplay', 'display', this.sxStyleDisplay);
    this.rebind(changes, 'sxStyleOpacity', 'opacity', this.sxStyleOpacity);
  }

  ngOnDestroy(): void {
    for (const binding of this.bindings.values()) {
      binding.destroy();
    }
    this.bindings.clear();
  }

  private rebind(
    changes: SimpleChanges,
    input: string,
    property: string,
    source: DependencySource<unknown> | null | undefined,
  ): void {
    if (!changes[input]) {
      return;
    }

    this.bindings.get(property)?.destroy();
    this.bindings.delete(property);

    if (!source) {
      return;
    }

    this.bindings.set(
      property,
      bindStyle(source, this.element.nativeElement, property),
    );
  }
}
