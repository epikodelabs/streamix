import {
  type Check,
  type Form,
  type FormCompleteValue,
  type NodeMap,
} from './forms';
import {
  bindControl,
  isNativeFieldElement,
  nativeControlSignature,
  type BoundControl,
  type NativeFieldElement,
} from './native-control';
import { resolveField, resolveNode } from './path';
import {
  findAttributeName,
  inferContainerPath,
  normalizePath,
  templateValidatorSignature,
  templateValidators,
  type BoundTemplateValidator,
  type TemplateValidatorContext,
  type TemplateValidatorDefinition,
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
    const attributeValue = element.getAttribute(attributeName);
    const baseContext = {
      root,
      element,
      attribute: definition.attribute,
      attributeValue,
    };

    if (definition.kind === 'field') {
      if (!isNativeFieldElement(element) || !element.name) return undefined;

      const field = resolveField(form, element.name);
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

    // Form-level validator
    const targetPath =
      definition.resolvePath?.(baseContext) ??
      normalizePath(attributeValue) ??
      inferContainerPath(element);

    if (!targetPath) return undefined;

    const node = resolveNode(form, targetPath);
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