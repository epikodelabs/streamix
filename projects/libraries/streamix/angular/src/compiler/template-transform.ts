import {
  parseSxTemplate,
  type ParseSxTemplateOptions,
  type ParsedSxTemplate,
} from './angular-template-parser';

export interface SxTemplateTransformResult {
  readonly template: string;
  readonly parsed: ParsedSxTemplate;
}

/**
 * Extracts Streamix-owned bindings while preserving Angular SSR/hydration
 * semantics.
 *
 * - Explicit `[sx.*]` bindings are rewritten to Angular-native `.value`
 *   fallbacks.
 * - Authored `.value` bindings/interpolations already are valid Angular
 *   fallbacks and remain untouched.
 * - Source-transparent bindings proven by the compile-time source resolver are
 *   rewritten to `.value` only in the Angular fallback template while the
 *   browser setup binds directly to the original DependencySource.
 */
export function transformSxTemplate(
  template: string,
  templateUrl = 'inline-template.html',
  options: ParseSxTemplateOptions = {},
): SxTemplateTransformResult {
  const parsed = parseSxTemplate(template, templateUrl, options);

  if (parsed.bindingEdits.length === 0) {
    return { template, parsed };
  }

  let transformed = template;

  // Replace compiler-owned fallbacks from right to left so source offsets stay
  // stable. The binding plan still points at the authored component paths.
  const edits = [...parsed.bindingEdits].sort((a, b) => b.start - a.start);

  for (const edit of edits) {
    transformed =
      transformed.slice(0, edit.start) +
      edit.replacement +
      transformed.slice(edit.end);
  }

  return { template: transformed, parsed };
}
