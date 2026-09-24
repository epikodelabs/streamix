import type {
  SxBlockInstance,
} from './structural-block';

interface StaticBinding {
  readonly node: Text;
  readonly expression: string;
  readonly prefix: string;
  readonly suffix: string;
}

interface StaticBlockInstance extends SxBlockInstance {
  readonly bindings: readonly StaticBinding[];
}

export function ɵcreateSxStaticBlock(
  html: string,
  context: Record<string, unknown>,
): SxBlockInstance {
  const template = document.createElement('template');
  template.innerHTML = html.trim();

  const fragment = template.content;
  const bindings: StaticBinding[] = [];

  collectTextBindings(fragment, bindings);

  for (const binding of bindings) {
    writeBinding(binding, context);
  }

  let first = fragment.firstChild;
  let last = fragment.lastChild;

  if (!first || !last) {
    const empty = document.createComment('sx:empty');
    fragment.appendChild(empty);
    first = empty;
    last = empty;
  }

  return {
    first,
    last,
    bindings,
    destroy() {},
  } as StaticBlockInstance;
}

export function ɵupdateSxStaticBlock(
  instance: SxBlockInstance,
  context: Record<string, unknown>,
): void {
  const block = instance as StaticBlockInstance;

  for (const binding of block.bindings ?? []) {
    writeBinding(binding, context);
  }
}

function collectTextBindings(
  root: Node,
  bindings: StaticBinding[],
): void {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );

  let node: Node | null;

  while ((node = walker.nextNode())) {
    const text = node.textContent ?? '';
    const match =
      /^(.*?)\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}(.*)$/.exec(text);

    if (!match) continue;

    bindings.push({
      node: node as Text,
      expression: match[2],
      prefix: match[1],
      suffix: match[3],
    });
  }
}

function writeBinding(
  binding: StaticBinding,
  context: Record<string, unknown>,
): void {
  const value = context[binding.expression];

  binding.node.data =
    binding.prefix +
    (value == null ? '' : String(value)) +
    binding.suffix;
}
