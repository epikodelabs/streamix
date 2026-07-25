import {
    type Field,
    type Form,
    type FormNode,
} from './forms';

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
  return node?.kind === 'field' ? (node as Field<unknown>) : undefined;
}