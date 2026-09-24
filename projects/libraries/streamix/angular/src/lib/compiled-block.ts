import type {
  SxBlockInstance,
} from './structural-block';

export interface SxCompiledBlockInstance<C extends object>
  extends SxBlockInstance {
  update(context: C): void;
}

export type SxCompiledBlockFactory<C extends object> = (
  context: C,
) => SxCompiledBlockInstance<C>;

/**
 * Small runtime constructor used by compiler-generated block factories.
 *
 * Generated code creates concrete DOM nodes itself and passes only the final
 * range + update closure here. There is no HTML parsing and no Angular view.
 *
 * @internal
 */
export function ɵcreateSxCompiledBlock<C extends object>(
  first: Node,
  last: Node,
  update: (context: C) => void,
  initialContext: C,
  destroy: () => void = () => {},
): SxCompiledBlockInstance<C> {
  const instance: SxCompiledBlockInstance<C> = {
    first,
    last,
    update,
    destroy,
  };

  update(initialContext);

  return instance;
}

/**
 * Compiler helper for a block whose top-level DOM consists of several nodes.
 * The fragment is used only as a detached construction container; once the
 * range is inserted by the structural runtime the fragment itself disappears.
 *
 * @internal
 */
export function ɵcreateSxFragmentRange(
  nodes: readonly Node[],
): {
  readonly fragment: DocumentFragment;
  readonly first: Node;
  readonly last: Node;
} {
  const fragment = document.createDocumentFragment();

  if (nodes.length === 0) {
    const empty = document.createComment('sx:empty');
    fragment.appendChild(empty);

    return {
      fragment,
      first: empty,
      last: empty,
    };
  }

  for (const node of nodes) {
    fragment.appendChild(node);
  }

  return {
    fragment,
    first: nodes[0],
    last: nodes[nodes.length - 1],
  };
}
