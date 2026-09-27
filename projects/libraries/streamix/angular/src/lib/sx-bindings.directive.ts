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
  bindClassMap,
  bindProperty,
  bindStyle,
  bindStyleMap,
  bindText,
  type DirectBinding,
  type SxClassMap,
  type SxStyleMap,
} from './direct-binding';

/**
 * Direct Streamix-to-DOM bindings.
 *
 * `SxBindingsDirective` intentionally combines two surfaces:
 *
 * - explicit common bindings such as `[sx.disabled]`, `[sx.class.active]`,
 *   and `[sx.style.transform]`;
 * - dynamic `[sx.class]` / `[sx.style]` maps for uncommon or grouped keys.
 *
 * The map bindings own only the keys they receive. They diff subsequent map
 * values, remove missing keys, and preserve unrelated static classes/styles.
 * Do not bind the same class/style key through both a map and a dotted binding
 * on one element; each binding assumes ownership of its own sink.
 *
 * The compiler can additionally lower arbitrary dotted sx bindings directly
 * to low-level primitives, so the explicit runtime aliases remain a curated
 * ergonomic set rather than an exhaustive DOM/CSS catalogue.
 */
@Directive({
  selector: '[sx\\.class],[sx\\.style],[sx\\.text],[sx\\.value],[sx\\.checked],[sx\\.disabled],[sx\\.selected],[sx\\.readOnly],[sx\\.required],[sx\\.multiple],[sx\\.hidden],[sx\\.open],[sx\\.placeholder],[sx\\.tabIndex],[sx\\.name],[sx\\.type],[sx\\.min],[sx\\.max],[sx\\.step],[sx\\.attr\\.role],[sx\\.attr\\.title],[sx\\.attr\\.tabindex],[sx\\.attr\\.aria-label],[sx\\.attr\\.aria-hidden],[sx\\.attr\\.aria-live],[sx\\.attr\\.aria-expanded],[sx\\.attr\\.aria-pressed],[sx\\.attr\\.aria-selected],[sx\\.attr\\.aria-current],[sx\\.attr\\.aria-controls],[sx\\.attr\\.aria-describedby],[sx\\.attr\\.aria-labelledby],[sx\\.class\\.active],[sx\\.class\\.selected],[sx\\.class\\.disabled],[sx\\.class\\.hidden],[sx\\.class\\.visible],[sx\\.class\\.open],[sx\\.class\\.expanded],[sx\\.class\\.loading],[sx\\.class\\.error],[sx\\.class\\.success],[sx\\.style\\.width],[sx\\.style\\.height],[sx\\.style\\.minWidth],[sx\\.style\\.maxWidth],[sx\\.style\\.minHeight],[sx\\.style\\.maxHeight],[sx\\.style\\.display],[sx\\.style\\.visibility],[sx\\.style\\.opacity],[sx\\.style\\.transform],[sx\\.style\\.transformOrigin],[sx\\.style\\.position],[sx\\.style\\.top],[sx\\.style\\.right],[sx\\.style\\.bottom],[sx\\.style\\.left],[sx\\.style\\.zIndex],[sx\\.style\\.overflow],[sx\\.style\\.gap],[sx\\.style\\.margin],[sx\\.style\\.padding],[sx\\.style\\.flex],[sx\\.style\\.justifyContent],[sx\\.style\\.alignItems],[sx\\.style\\.color],[sx\\.style\\.backgroundColor],[sx\\.style\\.fontSize],[sx\\.style\\.fontWeight],[sx\\.style\\.lineHeight],[sx\\.style\\.textAlign],[sx\\.style\\.borderRadius],[sx\\.style\\.boxShadow],[sx\\.style\\.pointerEvents]',
  standalone: true,
})
export class SxBindingsDirective implements OnChanges, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly bindings = new Map<string, DirectBinding>();

  @Input('sx.class')
  sxClass: DependencySource<SxClassMap | null | undefined> | null | undefined;

  @Input('sx.style')
  sxStyle: DependencySource<SxStyleMap | null | undefined> | null | undefined;

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

  @Input('sx.required')
  sxRequired: DependencySource<unknown> | null | undefined;

  @Input('sx.multiple')
  sxMultiple: DependencySource<unknown> | null | undefined;

  @Input('sx.hidden')
  sxHidden: DependencySource<unknown> | null | undefined;

  @Input('sx.open')
  sxOpen: DependencySource<unknown> | null | undefined;

  @Input('sx.placeholder')
  sxPlaceholder: DependencySource<unknown> | null | undefined;

  @Input('sx.tabIndex')
  sxTabIndex: DependencySource<unknown> | null | undefined;

  @Input('sx.name')
  sxName: DependencySource<unknown> | null | undefined;

  @Input('sx.type')
  sxType: DependencySource<unknown> | null | undefined;

  @Input('sx.min')
  sxMin: DependencySource<unknown> | null | undefined;

  @Input('sx.max')
  sxMax: DependencySource<unknown> | null | undefined;

  @Input('sx.step')
  sxStep: DependencySource<unknown> | null | undefined;

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

  @Input('sx.attr.aria-live')
  sxAttrAriaLive: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.aria-expanded')
  sxAttrAriaExpanded: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.aria-pressed')
  sxAttrAriaPressed: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.aria-selected')
  sxAttrAriaSelected: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.aria-current')
  sxAttrAriaCurrent: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.aria-controls')
  sxAttrAriaControls: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.aria-describedby')
  sxAttrAriaDescribedby: DependencySource<unknown> | null | undefined;

  @Input('sx.attr.aria-labelledby')
  sxAttrAriaLabelledby: DependencySource<unknown> | null | undefined;

  @Input('sx.class.active')
  sxClassActive: DependencySource<unknown> | null | undefined;

  @Input('sx.class.selected')
  sxClassSelected: DependencySource<unknown> | null | undefined;

  @Input('sx.class.disabled')
  sxClassDisabled: DependencySource<unknown> | null | undefined;

  @Input('sx.class.hidden')
  sxClassHidden: DependencySource<unknown> | null | undefined;

  @Input('sx.class.visible')
  sxClassVisible: DependencySource<unknown> | null | undefined;

  @Input('sx.class.open')
  sxClassOpen: DependencySource<unknown> | null | undefined;

  @Input('sx.class.expanded')
  sxClassExpanded: DependencySource<unknown> | null | undefined;

  @Input('sx.class.loading')
  sxClassLoading: DependencySource<unknown> | null | undefined;

  @Input('sx.class.error')
  sxClassError: DependencySource<unknown> | null | undefined;

  @Input('sx.class.success')
  sxClassSuccess: DependencySource<unknown> | null | undefined;

  @Input('sx.style.width')
  sxStyleWidth: DependencySource<unknown> | null | undefined;

  @Input('sx.style.height')
  sxStyleHeight: DependencySource<unknown> | null | undefined;

  @Input('sx.style.minWidth')
  sxStyleMinWidth: DependencySource<unknown> | null | undefined;

  @Input('sx.style.maxWidth')
  sxStyleMaxWidth: DependencySource<unknown> | null | undefined;

  @Input('sx.style.minHeight')
  sxStyleMinHeight: DependencySource<unknown> | null | undefined;

  @Input('sx.style.maxHeight')
  sxStyleMaxHeight: DependencySource<unknown> | null | undefined;

  @Input('sx.style.display')
  sxStyleDisplay: DependencySource<unknown> | null | undefined;

  @Input('sx.style.visibility')
  sxStyleVisibility: DependencySource<unknown> | null | undefined;

  @Input('sx.style.opacity')
  sxStyleOpacity: DependencySource<unknown> | null | undefined;

  @Input('sx.style.transform')
  sxStyleTransform: DependencySource<unknown> | null | undefined;

  @Input('sx.style.transformOrigin')
  sxStyleTransformOrigin: DependencySource<unknown> | null | undefined;

  @Input('sx.style.position')
  sxStylePosition: DependencySource<unknown> | null | undefined;

  @Input('sx.style.top')
  sxStyleTop: DependencySource<unknown> | null | undefined;

  @Input('sx.style.right')
  sxStyleRight: DependencySource<unknown> | null | undefined;

  @Input('sx.style.bottom')
  sxStyleBottom: DependencySource<unknown> | null | undefined;

  @Input('sx.style.left')
  sxStyleLeft: DependencySource<unknown> | null | undefined;

  @Input('sx.style.zIndex')
  sxStyleZIndex: DependencySource<unknown> | null | undefined;

  @Input('sx.style.overflow')
  sxStyleOverflow: DependencySource<unknown> | null | undefined;

  @Input('sx.style.gap')
  sxStyleGap: DependencySource<unknown> | null | undefined;

  @Input('sx.style.margin')
  sxStyleMargin: DependencySource<unknown> | null | undefined;

  @Input('sx.style.padding')
  sxStylePadding: DependencySource<unknown> | null | undefined;

  @Input('sx.style.flex')
  sxStyleFlex: DependencySource<unknown> | null | undefined;

  @Input('sx.style.justifyContent')
  sxStyleJustifyContent: DependencySource<unknown> | null | undefined;

  @Input('sx.style.alignItems')
  sxStyleAlignItems: DependencySource<unknown> | null | undefined;

  @Input('sx.style.color')
  sxStyleColor: DependencySource<unknown> | null | undefined;

  @Input('sx.style.backgroundColor')
  sxStyleBackgroundColor: DependencySource<unknown> | null | undefined;

  @Input('sx.style.fontSize')
  sxStyleFontSize: DependencySource<unknown> | null | undefined;

  @Input('sx.style.fontWeight')
  sxStyleFontWeight: DependencySource<unknown> | null | undefined;

  @Input('sx.style.lineHeight')
  sxStyleLineHeight: DependencySource<unknown> | null | undefined;

  @Input('sx.style.textAlign')
  sxStyleTextAlign: DependencySource<unknown> | null | undefined;

  @Input('sx.style.borderRadius')
  sxStyleBorderRadius: DependencySource<unknown> | null | undefined;

  @Input('sx.style.boxShadow')
  sxStyleBoxShadow: DependencySource<unknown> | null | undefined;

  @Input('sx.style.pointerEvents')
  sxStylePointerEvents: DependencySource<unknown> | null | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    this.rebind(
      changes,
      'sxClass',
      'class:map',
      this.sxClass,
      source => bindClassMap(source, this.element.nativeElement),
    );

    this.rebind(
      changes,
      'sxStyle',
      'style:map',
      this.sxStyle,
      source => bindStyleMap(source, this.element.nativeElement),
    );

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
    this.rebindProperty(changes, 'sxRequired', 'required', this.sxRequired);
    this.rebindProperty(changes, 'sxMultiple', 'multiple', this.sxMultiple);
    this.rebindProperty(changes, 'sxHidden', 'hidden', this.sxHidden);
    this.rebindProperty(changes, 'sxOpen', 'open', this.sxOpen);
    this.rebindProperty(changes, 'sxPlaceholder', 'placeholder', this.sxPlaceholder);
    this.rebindProperty(changes, 'sxTabIndex', 'tabIndex', this.sxTabIndex);
    this.rebindProperty(changes, 'sxName', 'name', this.sxName);
    this.rebindProperty(changes, 'sxType', 'type', this.sxType);
    this.rebindProperty(changes, 'sxMin', 'min', this.sxMin);
    this.rebindProperty(changes, 'sxMax', 'max', this.sxMax);
    this.rebindProperty(changes, 'sxStep', 'step', this.sxStep);

    this.rebindAttribute(changes, 'sxAttrRole', 'role', this.sxAttrRole);
    this.rebindAttribute(changes, 'sxAttrTitle', 'title', this.sxAttrTitle);
    this.rebindAttribute(changes, 'sxAttrTabindex', 'tabindex', this.sxAttrTabindex);
    this.rebindAttribute(changes, 'sxAttrAriaLabel', 'aria-label', this.sxAttrAriaLabel);
    this.rebindAttribute(changes, 'sxAttrAriaHidden', 'aria-hidden', this.sxAttrAriaHidden);
    this.rebindAttribute(changes, 'sxAttrAriaLive', 'aria-live', this.sxAttrAriaLive);
    this.rebindAttribute(changes, 'sxAttrAriaExpanded', 'aria-expanded', this.sxAttrAriaExpanded);
    this.rebindAttribute(changes, 'sxAttrAriaPressed', 'aria-pressed', this.sxAttrAriaPressed);
    this.rebindAttribute(changes, 'sxAttrAriaSelected', 'aria-selected', this.sxAttrAriaSelected);
    this.rebindAttribute(changes, 'sxAttrAriaCurrent', 'aria-current', this.sxAttrAriaCurrent);
    this.rebindAttribute(changes, 'sxAttrAriaControls', 'aria-controls', this.sxAttrAriaControls);
    this.rebindAttribute(changes, 'sxAttrAriaDescribedby', 'aria-describedby', this.sxAttrAriaDescribedby);
    this.rebindAttribute(changes, 'sxAttrAriaLabelledby', 'aria-labelledby', this.sxAttrAriaLabelledby);

    this.rebindClass(changes, 'sxClassActive', 'active', this.sxClassActive);
    this.rebindClass(changes, 'sxClassSelected', 'selected', this.sxClassSelected);
    this.rebindClass(changes, 'sxClassDisabled', 'disabled', this.sxClassDisabled);
    this.rebindClass(changes, 'sxClassHidden', 'hidden', this.sxClassHidden);
    this.rebindClass(changes, 'sxClassVisible', 'visible', this.sxClassVisible);
    this.rebindClass(changes, 'sxClassOpen', 'open', this.sxClassOpen);
    this.rebindClass(changes, 'sxClassExpanded', 'expanded', this.sxClassExpanded);
    this.rebindClass(changes, 'sxClassLoading', 'loading', this.sxClassLoading);
    this.rebindClass(changes, 'sxClassError', 'error', this.sxClassError);
    this.rebindClass(changes, 'sxClassSuccess', 'success', this.sxClassSuccess);

    this.rebindStyle(changes, 'sxStyleWidth', 'width', this.sxStyleWidth);
    this.rebindStyle(changes, 'sxStyleHeight', 'height', this.sxStyleHeight);
    this.rebindStyle(changes, 'sxStyleMinWidth', 'minWidth', this.sxStyleMinWidth);
    this.rebindStyle(changes, 'sxStyleMaxWidth', 'maxWidth', this.sxStyleMaxWidth);
    this.rebindStyle(changes, 'sxStyleMinHeight', 'minHeight', this.sxStyleMinHeight);
    this.rebindStyle(changes, 'sxStyleMaxHeight', 'maxHeight', this.sxStyleMaxHeight);
    this.rebindStyle(changes, 'sxStyleDisplay', 'display', this.sxStyleDisplay);
    this.rebindStyle(changes, 'sxStyleVisibility', 'visibility', this.sxStyleVisibility);
    this.rebindStyle(changes, 'sxStyleOpacity', 'opacity', this.sxStyleOpacity);
    this.rebindStyle(changes, 'sxStyleTransform', 'transform', this.sxStyleTransform);
    this.rebindStyle(changes, 'sxStyleTransformOrigin', 'transformOrigin', this.sxStyleTransformOrigin);
    this.rebindStyle(changes, 'sxStylePosition', 'position', this.sxStylePosition);
    this.rebindStyle(changes, 'sxStyleTop', 'top', this.sxStyleTop);
    this.rebindStyle(changes, 'sxStyleRight', 'right', this.sxStyleRight);
    this.rebindStyle(changes, 'sxStyleBottom', 'bottom', this.sxStyleBottom);
    this.rebindStyle(changes, 'sxStyleLeft', 'left', this.sxStyleLeft);
    this.rebindStyle(changes, 'sxStyleZIndex', 'zIndex', this.sxStyleZIndex);
    this.rebindStyle(changes, 'sxStyleOverflow', 'overflow', this.sxStyleOverflow);
    this.rebindStyle(changes, 'sxStyleGap', 'gap', this.sxStyleGap);
    this.rebindStyle(changes, 'sxStyleMargin', 'margin', this.sxStyleMargin);
    this.rebindStyle(changes, 'sxStylePadding', 'padding', this.sxStylePadding);
    this.rebindStyle(changes, 'sxStyleFlex', 'flex', this.sxStyleFlex);
    this.rebindStyle(changes, 'sxStyleJustifyContent', 'justifyContent', this.sxStyleJustifyContent);
    this.rebindStyle(changes, 'sxStyleAlignItems', 'alignItems', this.sxStyleAlignItems);
    this.rebindStyle(changes, 'sxStyleColor', 'color', this.sxStyleColor);
    this.rebindStyle(changes, 'sxStyleBackgroundColor', 'backgroundColor', this.sxStyleBackgroundColor);
    this.rebindStyle(changes, 'sxStyleFontSize', 'fontSize', this.sxStyleFontSize);
    this.rebindStyle(changes, 'sxStyleFontWeight', 'fontWeight', this.sxStyleFontWeight);
    this.rebindStyle(changes, 'sxStyleLineHeight', 'lineHeight', this.sxStyleLineHeight);
    this.rebindStyle(changes, 'sxStyleTextAlign', 'textAlign', this.sxStyleTextAlign);
    this.rebindStyle(changes, 'sxStyleBorderRadius', 'borderRadius', this.sxStyleBorderRadius);
    this.rebindStyle(changes, 'sxStyleBoxShadow', 'boxShadow', this.sxStyleBoxShadow);
    this.rebindStyle(changes, 'sxStylePointerEvents', 'pointerEvents', this.sxStylePointerEvents);
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

  private rebind<T>(
    changes: SimpleChanges,
    input: string,
    key: string,
    source: DependencySource<T> | null | undefined,
    bind: (source: DependencySource<T>) => DirectBinding,
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
