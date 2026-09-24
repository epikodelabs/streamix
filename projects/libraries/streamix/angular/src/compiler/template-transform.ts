import {
  parseSxTemplate,
  type ParsedSxTemplate,
} from './angular-template-parser';

export interface SxTemplateTransformResult {
  readonly template: string;
  readonly parsed: ParsedSxTemplate;
}

/**
 * Extracts sx bindings and removes them from Angular's binding system.
 *
 * Unlike the earlier bridge, no `data-sx` marker is emitted. The parser has
 * already computed stable element-only paths for compiler-generated setup.
 */
export function transformSxTemplate(
  template: string,
  templateUrl = 'inline-template.html',
): SxTemplateTransformResult {
  const parsed = parseSxTemplate(template, templateUrl);

  if (parsed.plan.size === 0) {
    return { template, parsed };
  }

  let transformed = template;

  // Cut by the parser-recorded attribute offsets rather than a regex so both
  // quote styles are removed exactly and sx-looking text content is never
  // touched. Cuts run back-to-front so earlier offsets stay valid.
  const spans = [...parsed.bindingSpans].sort((a, b) => b.start - a.start);

  for (const span of spans) {
    let start = span.start;
    while (start > 0 && /\s/.test(transformed[start - 1])) {
      start--;
    }
    transformed =
      transformed.slice(0, start) + transformed.slice(span.end);
  }

  return { template: transformed, parsed };
}
