import {
    type Form
} from './forms';
import {
    bindControl,
    nativeControlSignature,
    type BoundControl,
    type NativeFieldElement
} from './native-control';
import { resolveField } from './path';
import {
    findAttributeName,
    templateValidators,
    type BoundTemplateValidator,
    type TemplateValidatorDefinition
} from './template-validators';

export interface FormDomBinding {
  refresh(): void;
  dispose(): void;
}

export interface BindFormOptions {
  noValidate?: boolean;
}

export function bindForm(
  root: HTMLElement,
  form: Form<any>,
  options: BindFormOptions = {},
): FormDomBinding {
  const controls = new Map<NativeFieldElement, BoundControl>();
  const validatorBindings = new Map<
    Element,
    Map<string, BoundTemplateValidator>
  >();

  let refreshQueued = false;
  let disposed = false;

  const refresh = (): void => {
    if (disposed) return;
    refreshControls();
    refreshTemplateValidators();
  };

  const queueRefresh = (): void => {
    if (refreshQueued || disposed) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      refresh();
    });
  };

  const nativeForm =
    root instanceof HTMLFormElement ? root : root.closest('form');

  if (nativeForm && options.noValidate !== false) {
    nativeForm.noValidate = true;
  }

  refresh();

  const observer = new MutationObserver(queueRefresh);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
  });

  return {
    refresh,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      controls.forEach(c => c.dispose());
      controls.clear();
      validatorBindings.forEach(bindings => {
        bindings.forEach(binding => binding.dispose());
      });
      validatorBindings.clear();
    },
  };

  function refreshControls(): void {
    const seen = new Set<NativeFieldElement>();
    root
      .querySelectorAll<NativeFieldElement>(
        'input[name], textarea[name], select[name]',
      )
      .forEach(element => {
        seen.add(element);
        const field = resolveField(form, element.name);
        if (!field) {
          const existing = controls.get(element);
          if (existing) {
            existing.dispose();
            controls.delete(element);
          }
          return;
        }

        const signature = nativeControlSignature(element);
        const existing = controls.get(element);
        if (
          existing &&
          existing.field === field &&
          existing.signature === signature
        ) {
          return;
        }

        existing?.dispose();
        controls.set(element, bindControl(element, field, signature));
      });

    controls.forEach((control, element) => {
      if (seen.has(element)) return;
      control.dispose();
      controls.delete(element);
    });
  }

  function refreshTemplateValidators(): void {
    const elements: Element[] = [root, ...root.querySelectorAll('*')];
    const seen = new Set(elements);

    for (const element of elements) {
      refreshElementValidators(element);
    }

    validatorBindings.forEach((bindings, element) => {
      if (seen.has(element)) return;
      bindings.forEach(binding => binding.dispose());
      validatorBindings.delete(element);
    });
  }

  function refreshElementValidators(element: Element): void {
    let bindings = validatorBindings.get(element);
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

      const binding = createTemplateValidatorBinding(
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
      validatorBindings.set(element, bindings);
    } else {
      validatorBindings.delete(element);
    }
  }

  function createTemplateValidatorBinding(
    element: Element,
    attributeName: string,
    definition: TemplateValidatorDefinition,
    existing?: BoundTemplateValidator,
  ): BoundTemplateValidator | undefined {
    // Implementation will be added in the next steps
    return undefined;
  }
}