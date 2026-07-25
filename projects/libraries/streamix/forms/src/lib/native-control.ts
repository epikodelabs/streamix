import {
    checks,
    watchNode,
    type Check,
    type Field,
} from './forms';

export type NativeFieldElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

export type ElementKind =
  | 'checkbox'
  | 'radio'
  | 'number'
  | 'select'
  | 'text';

export interface BoundControl {
  readonly element: NativeFieldElement;
  readonly field: Field<unknown>;
  readonly signature: string;
  readonly dispose: () => void;
}

export function bindControl(
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
      field.invalid.value && (field.dirty.value || field.touched.value);

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

export function isNativeFieldElement(
  element: Element,
): element is NativeFieldElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

export function detectKind(element: NativeFieldElement): ElementKind {
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

export function usesInputEvent(kind: ElementKind): boolean {
  return kind !== 'select' && kind !== 'checkbox' && kind !== 'radio';
}

export function readControlValue(
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

export function writeControlValue(
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

export function collectNativeChecks(
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
        kind === 'checkbox' ? checks.requiredTrue : checks.required,
      );
    }

    if (element.minLength >= 0 && element.hasAttribute('minlength')) {
      nativeChecks.push(checks.minLength(element.minLength));
    }

    if (element.maxLength >= 0 && element.hasAttribute('maxlength')) {
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

export function nativeControlSignature(element: NativeFieldElement): string {
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