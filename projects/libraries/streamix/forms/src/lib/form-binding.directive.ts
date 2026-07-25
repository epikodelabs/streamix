import {
  AfterViewInit,
  Directive,
  ElementRef,
  Input,
  OnDestroy,
  inject,
} from '@angular/core';
import {
  abortableDelay,
  checks,
  watchNode,
  type AsyncCheck,
  type Check,
  type Field,
  type FieldValidationSource,
  type Form,
  type FormCompleteValue,
  type FormNode,
  type NodeMap,
} from './forms';

type NativeFieldElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

type ElementKind =
  | 'checkbox'
  | 'radio'
  | 'number'
  | 'select'
  | 'text';

export interface TemplateValidatorContext {
  readonly root: HTMLElement;
  readonly element: Element;
  readonly attribute: string;
  readonly attributeValue: string | null;
  readonly targetPath: string;
}

export interface FieldTemplateValidatorDefinition {
  readonly kind: 'field';
  readonly attribute: string;
  readonly validation: (
    context: TemplateValidatorContext,
  ) => FieldValidationSource<unknown>;
}

export interface FormTemplateValidatorDefinition {
  readonly kind: 'form';
  readonly attribute: string;
  readonly checks: (
    context: TemplateValidatorContext,
  ) => Check<any> | readonly Check<any>[];
  readonly resolvePath?: (
    context: Omit<TemplateValidatorContext, 'targetPath'>,
  ) => string | undefined;
}

export type TemplateValidatorDefinition =
  | FieldTemplateValidatorDefinition
  | FormTemplateValidatorDefinition;

interface BoundControl {
  readonly element: NativeFieldElement;
  readonly field: Field<unknown>;
  readonly signature: string;
  readonly dispose: () => void;
}

interface BoundTemplateValidator {
  readonly definition: TemplateValidatorDefinition;
  readonly signature: string;
  readonly dispose: () => void;
}

const templateValidators = new Map<string, TemplateValidatorDefinition>();

/**
 * Registers a template-declared validator.
 *
 * Attribute names are normalized because HTML attribute names are
 * case-insensitive and are exposed in lowercase by the DOM.
 */
export function defineTemplateValidator<T extends TemplateValidatorDefinition>(
  definition: T,
): T {
  const key = normalizeAttribute(definition.attribute);

  if (templateValidators.has(key)) {
    throw new Error(
      `Template validator "${definition.attribute}" is already registered.`,
    );
  }

  templateValidators.set(key, definition);
  return definition;
}

/** Convenience helper for field validators. */
export function defineFieldValidator(
  attribute: string,
  validation:
    | FieldValidationSource<unknown>
    | ((context: TemplateValidatorContext) => FieldValidationSource<unknown>),
): FieldTemplateValidatorDefinition {
  return defineTemplateValidator({
    kind: 'field',
    attribute,
    validation:
      typeof validation === 'function'
        ? validation
        : () => validation,
  });
}

/** Convenience helper for form/group validators. */
export function defineFormValidator(
  attribute: string,
  checksFactory: FormTemplateValidatorDefinition['checks'],
  resolvePath?: FormTemplateValidatorDefinition['resolvePath'],
): FormTemplateValidatorDefinition {
  return defineTemplateValidator({
    kind: 'form',
    attribute,
    checks: checksFactory,
    resolvePath,
  });
}

@Directive({
  selector: '[sxFormBinding]',
  standalone: true,
})
export class StreamixFormBindingDirective
  implements AfterViewInit, OnDestroy {
  @Input({ required: true })
  sxFormBinding!: Form<any>;

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly controls = new Map<NativeFieldElement, BoundControl>();
  private readonly validatorBindings = new Map<
    Element,
    Map<string, BoundTemplateValidator>
  >();

  private observer?: MutationObserver;
  private refreshQueued = false;

  ngAfterViewInit(): void {
    this.bindForm();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = undefined;

    this.controls.forEach(control => control.dispose());
    this.controls.clear();

    this.validatorBindings.forEach(bindings => {
      bindings.forEach(binding => binding.dispose());
    });
    this.validatorBindings.clear();
  }

  private bindForm(): void {
    const root = this.elementRef.nativeElement;
    const nativeForm =
      root instanceof HTMLFormElement
        ? root
        : root.closest('form');

    if (nativeForm) nativeForm.noValidate = true;

    this.refresh();

    this.observer = new MutationObserver(() => this.queueRefresh());
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  }

  private queueRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;

    queueMicrotask(() => {
      this.refreshQueued = false;
      this.refresh();
    });
  }

  private refresh(): void {
    this.refreshControls();
    this.refreshTemplateValidators();
  }

  private refreshControls(): void {
    const root = this.elementRef.nativeElement;
    const seen = new Set<NativeFieldElement>();

    root
      .querySelectorAll<NativeFieldElement>(
        'input[name], textarea[name], select[name]',
      )
      .forEach(element => {
        seen.add(element);

        const field = resolveField(this.sxFormBinding, element.name);
        if (!field) {
          this.removeControl(element);
          return;
        }

        const signature = nativeControlSignature(element);
        const existing = this.controls.get(element);

        if (
          existing &&
          existing.field === field &&
          existing.signature === signature
        ) {
          return;
        }

        existing?.dispose();
        this.controls.set(
          element,
          bindControl(element, field, signature),
        );
      });

    this.controls.forEach((control, element) => {
      if (seen.has(element)) return;
      control.dispose();
      this.controls.delete(element);
    });
  }

  private removeControl(element: NativeFieldElement): void {
    const existing = this.controls.get(element);
    if (!existing) return;
    existing.dispose();
    this.controls.delete(element);
  }

  private refreshTemplateValidators(): void {
    const root = this.elementRef.nativeElement;
    const elements: Element[] = [root, ...root.querySelectorAll('*')];
    const seen = new Set(elements);

    for (const element of elements) {
      this.refreshElementValidators(element);
    }

    this.validatorBindings.forEach((bindings, element) => {
      if (seen.has(element)) return;

      bindings.forEach(binding => binding.dispose());
      this.validatorBindings.delete(element);
    });
  }

  private refreshElementValidators(element: Element): void {
    let bindings = this.validatorBindings.get(element);

    for (const [key, definition] of templateValidators) {
      const attributeName = findAttributeName(element, key);
      const existing = bindings?.get(key);

      if (!attributeName) {
        if (existing) {
          existing.dispose();
          bindings!.delete(key);
        }
        continue;
      }

      const binding = this.createTemplateValidatorBinding(
        element,
        attributeName,
        definition,
        existing,
      );

      if (!binding) {
        if (existing) {
          existing.dispose();
          bindings!.delete(key);
        }
        continue;
      }

      if (binding === existing) continue;

      existing?.dispose();
      bindings ??= new Map<string, BoundTemplateValidator>();
      bindings.set(key, binding);
    }

    if (bindings && bindings.size > 0) {
      this.validatorBindings.set(element, bindings);
    } else {
      this.validatorBindings.delete(element);
    }
  }

  private createTemplateValidatorBinding(
    element: Element,
    attributeName: string,
    definition: TemplateValidatorDefinition,
    existing?: BoundTemplateValidator,
  ): BoundTemplateValidator | undefined {
    const root = this.elementRef.nativeElement;
    const attributeValue = element.getAttribute(attributeName);
    const baseContext = {
      root,
      element,
      attribute: definition.attribute,
      attributeValue,
    };

    if (definition.kind === 'field') {
      if (!isNativeFieldElement(element) || !element.name) return undefined;

      const field = resolveField(this.sxFormBinding, element.name);
      if (!field) return undefined;

      const targetPath = element.name;
      const signature = templateValidatorSignature(
        definition,
        targetPath,
        attributeValue,
      );
      if (existing?.signature === signature) return existing;

      const source = {};
      const validation = definition.validation({
        ...baseContext,
        targetPath,
      });

      field.useValidation(source, validation);

      return {
        definition,
        signature,
        dispose: () => {
          if (!field.state.disposed) field.clearValidation(source);
        },
      };
    }

    const targetPath =
      definition.resolvePath?.(baseContext) ??
      normalizePath(attributeValue) ??
      inferContainerPath(element);

    if (!targetPath) return undefined;

    const node = resolveNode(this.sxFormBinding, targetPath);
    if (!node || node.kind !== 'form') return undefined;

    const target = node as Form<NodeMap>;
    const signature = templateValidatorSignature(
      definition,
      targetPath,
      attributeValue,
    );
    if (existing?.signature === signature) return existing;

    const source = {};
    const context: TemplateValidatorContext = {
      ...baseContext,
      targetPath,
    };

    target.useChecks(
      source,
      definition.checks(context) as Check<FormCompleteValue<NodeMap>>,
    );

    return {
      definition,
      signature,
      dispose: () => {
        if (!target.state.disposed) target.clearChecks(source);
      },
    };
  }
}

// --------------------------------------------------------------------------
// Public resolution helpers
// --------------------------------------------------------------------------

export function resolveNode(
  root: Form<any>,
  path: string,
): FormNode<any, any> | undefined {
  const segments = path.split('.').filter(Boolean);
  let current: FormNode<any, any> = root;

  for (const segment of segments) {
    if (current.kind === 'form') {
      const next = (current as Form<any>).fields[segment] as
        | FormNode<any, any>
        | undefined;

      if (!next) return undefined;
      current = next;
      continue;
    }

    if (current.kind === 'list') {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;

      const next = (
        current as unknown as {
          items: readonly FormNode<any, any>[];
        }
      ).items[index];

      if (!next) return undefined;
      current = next;
      continue;
    }

    return undefined;
  }

  return current;
}

export function resolveField(
  root: Form<any>,
  path: string,
): Field<unknown> | undefined {
  const node = resolveNode(root, path);
  return node?.kind === 'field'
    ? node as Field<unknown>
    : undefined;
}

// --------------------------------------------------------------------------
// Native control binding
// --------------------------------------------------------------------------

function bindControl(
  element: NativeFieldElement,
  field: Field<unknown>,
  signature: string,
): BoundControl {
  const nativeSource = {};
  const kind = detectKind(element);

  field.useValidation(nativeSource, {
    checks: collectNativeChecks(element, kind),
  });

  const render = (): void => {
    element.disabled = field.disabled.value;
    writeControlValue(element, kind, field.completeValue.value);

    const invalid =
      field.invalid.value &&
      (field.dirty.value || field.touched.value);

    element.classList.toggle('is-invalid', invalid);
    element.classList.toggle('is-pending', field.pending.value);
    element.setAttribute('aria-invalid', String(invalid));
  };

  const handleInput = (): void => {
    if (usesInputEvent(kind)) {
      field.set(readControlValue(element, kind));
    }
  };

  const handleChange = (): void => {
    if (usesInputEvent(kind)) return;

    if (
      kind === 'radio' &&
      element instanceof HTMLInputElement &&
      !element.checked
    ) {
      return;
    }

    field.set(readControlValue(element, kind));
  };

  const handleBlur = (): void => field.touch();

  element.addEventListener('input', handleInput);
  element.addEventListener('change', handleChange);
  element.addEventListener('blur', handleBlur);

  const stopWatching = watchNode(field, render);
  render();

  return {
    element,
    field,
    signature,
    dispose(): void {
      element.removeEventListener('input', handleInput);
      element.removeEventListener('change', handleChange);
      element.removeEventListener('blur', handleBlur);
      stopWatching();

      if (!field.state.disposed) {
        field.clearValidation(nativeSource);
      }
    },
  };
}

// --------------------------------------------------------------------------
// DOM helpers
// --------------------------------------------------------------------------

function isNativeFieldElement(
  element: Element,
): element is NativeFieldElement {
  return element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement;
}

function detectKind(element: NativeFieldElement): ElementKind {
  if (element instanceof HTMLSelectElement) return 'select';

  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') return 'checkbox';
    if (element.type === 'radio') return 'radio';
    if (element.type === 'number' || element.type === 'range') {
      return 'number';
    }
  }

  return 'text';
}

function usesInputEvent(kind: ElementKind): boolean {
  return kind !== 'select' &&
    kind !== 'checkbox' &&
    kind !== 'radio';
}

function readControlValue(
  element: NativeFieldElement,
  kind: ElementKind,
): unknown {
  if (element instanceof HTMLInputElement) {
    switch (kind) {
      case 'checkbox':
        return element.checked;
      case 'number':
        return element.value === '' ? null : element.valueAsNumber;
      case 'radio':
        return element.value;
    }
  }

  return element.value;
}

function writeControlValue(
  element: NativeFieldElement,
  kind: ElementKind,
  value: unknown,
): void {
  if (element instanceof HTMLInputElement) {
    if (kind === 'checkbox') {
      element.checked = Boolean(value);
      return;
    }

    if (kind === 'radio') {
      element.checked = String(value ?? '') === element.value;
      return;
    }
  }

  const rendered = value == null ? '' : String(value);
  if (element.value !== rendered) element.value = rendered;
}

function collectNativeChecks(
  element: NativeFieldElement,
  kind: ElementKind,
): Check<unknown>[] {
  const nativeChecks: Check<unknown>[] = [];

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (element.required) {
      nativeChecks.push(
        kind === 'checkbox'
          ? checks.requiredTrue
          : checks.required,
      );
    }

    if (
      element.minLength >= 0 &&
      element.hasAttribute('minlength')
    ) {
      nativeChecks.push(checks.minLength(element.minLength));
    }

    if (
      element.maxLength >= 0 &&
      element.hasAttribute('maxlength')
    ) {
      nativeChecks.push(checks.maxLength(element.maxLength));
    }
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === 'email') {
      nativeChecks.push(checks.email);
    }

    if (element.pattern) {
      nativeChecks.push(checks.pattern(element.pattern));
    }

    if (kind === 'number' && element.min !== '') {
      const minimum = Number(element.min);
      if (Number.isFinite(minimum)) {
        nativeChecks.push(checks.min(minimum));
      }
    }

    if (kind === 'number' && element.max !== '') {
      const maximum = Number(element.max);
      if (Number.isFinite(maximum)) {
        nativeChecks.push(checks.max(maximum));
      }
    }
  }

  return nativeChecks;
}

function nativeControlSignature(element: NativeFieldElement): string {
  return [
    element.name,
    element instanceof HTMLInputElement ? element.type : element.tagName,
    element.hasAttribute('required') ? 'required' : '',
    element.getAttribute('minlength') ?? '',
    element.getAttribute('maxlength') ?? '',
    element.getAttribute('pattern') ?? '',
    element.getAttribute('min') ?? '',
    element.getAttribute('max') ?? '',
  ].join('|');
}

function templateValidatorSignature(
  definition: TemplateValidatorDefinition,
  targetPath: string,
  attributeValue: string | null,
): string {
  return [
    definition.kind,
    normalizeAttribute(definition.attribute),
    targetPath,
    attributeValue ?? '',
  ].join('|');
}

function normalizeAttribute(attribute: string): string {
  return attribute.trim().toLowerCase();
}

function findAttributeName(
  element: Element,
  normalizedName: string,
): string | undefined {
  return element.getAttributeNames().find(
    name => normalizeAttribute(name) === normalizedName,
  );
}

function normalizePath(value: string | null): string | undefined {
  const path = value?.trim();
  return path ? path : undefined;
}

/**
 * Infers the target form from descendant control names.
 *
 * Example:
 *   security.password
 *   security.confirmPassword
 *
 * resolves to:
 *   security
 */
function inferContainerPath(element: Element): string | undefined {
  const paths = Array.from(
    element.querySelectorAll<NativeFieldElement>(
      'input[name], textarea[name], select[name]',
    ),
    control => control.name.split('.').filter(Boolean),
  ).filter(parts => parts.length > 1);

  if (paths.length === 0) return undefined;

  const first = paths[0];
  let commonLength = first.length - 1;

  for (let index = 1; index < paths.length; index++) {
    const current = paths[index];
    commonLength = Math.min(commonLength, current.length - 1);

    let part = 0;
    while (
      part < commonLength &&
      first[part] === current[part]
    ) {
      part++;
    }

    commonLength = part;
    if (commonLength === 0) return undefined;
  }

  return first.slice(0, commonLength).join('.');
}

// --------------------------------------------------------------------------
// Built-in template validators
// --------------------------------------------------------------------------

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'streamix',
  'support',
  'system',
]);

const reservedUsernameCheck: AsyncCheck<unknown> = async (
  value,
  signal,
) => {
  await abortableDelay(350, signal);
  if (signal.aborted) return null;

  const username = String(value ?? '').trim().toLowerCase();

  return RESERVED_USERNAMES.has(username)
    ? { usernameTaken: true }
    : null;
};

defineFieldValidator('reservedUsername', {
  asyncChecks: reservedUsernameCheck,
  asyncDelay: 250,
  asyncOnlyWhenSyncClean: true,
});

defineFormValidator(
  'passwordMatch',
  () => value => {
    const candidate = value as {
      password?: unknown;
      confirmPassword?: unknown;
    };

    const password = String(candidate.password ?? '');
    const confirmation = String(candidate.confirmPassword ?? '');

    // Let required/minLength own incomplete values. This validator reports
    // only an actual mismatch once both values are present.
    if (!password || !confirmation) return null;

    return password === confirmation
      ? null
      : { passwordMismatch: true };
  },
);
