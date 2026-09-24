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
  const matches = Array.from(
    transformed.matchAll(/\s+\[sx(?:\.[^\]]+)\]\s*=\s*"[^"]*"/g),
  ).reverse();

  for (const match of matches) {
    const start = match.index!;
    transformed =
      transformed.slice(0, start) +
      transformed.slice(start + match[0].length);
  }

  return { template: transformed, parsed };
}
