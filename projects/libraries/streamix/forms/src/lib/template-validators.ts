import {
    type Check,
    type FieldValidationSource
} from './forms';

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

export interface BoundTemplateValidator {
  readonly definition: TemplateValidatorDefinition;
  readonly signature: string;
  readonly dispose: () => void;
}

export const templateValidators = new Map<string, TemplateValidatorDefinition>();

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

export function defineFieldValidator(
  attribute: string,
  validation:
    | FieldValidationSource<unknown>
    | ((context: TemplateValidatorContext) => FieldValidationSource<unknown>),
): FieldTemplateValidatorDefinition {
  return defineTemplateValidator({
    kind: 'field',
    attribute,
    validation: typeof validation === 'function' ? validation : () => validation,
  });
}

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

export function templateValidatorSignature(
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

export function normalizeAttribute(attribute: string): string {
  return attribute.trim().toLowerCase();
}

export function findAttributeName(
  element: Element,
  normalizedName: string,
): string | undefined {
  return element
    .getAttributeNames()
    .find(name => normalizeAttribute(name) === normalizedName);
}

export function normalizePath(value: string | null): string | undefined {
  const path = value?.trim();
  return path ? path : undefined;
}

export function inferContainerPath(element: Element): string | undefined {
  const paths = Array.from(
    element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input[name], textarea[name], select[name]',
    ),
    control => control.name.split('.').filter(Boolean),
  ).filter(parts => parts.length > 1);

  if (paths.length === 0) {
    return undefined;
  }

  const first = paths[0]!;
  let commonLength = first.length - 1;

  for (let index = 1; index < paths.length; index++) {
    const current = paths[index]!;
    commonLength = Math.min(commonLength, current.length - 1);

    let part = 0;
    while (
      part < commonLength &&
      first[part] === current[part]
    ) {
      part++;
    }

    commonLength = part;
    if (commonLength === 0) {
      return undefined;
    }
  }

  if (commonLength === 0) {
    return undefined;
  }

  return first.slice(0, commonLength).join('.');
}