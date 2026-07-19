export type FieldPath = string;
export type FieldValueKind = 'text' | 'number' | 'boolean';
export type FormValuePrimitive = string | number | boolean;

export function parseFormValue(
  event: Event,
  kind: FieldValueKind = 'text',
): FormValuePrimitive {
  if (kind === 'boolean') {
    return (event.target as HTMLInputElement).checked;
  }

  const target = event.target as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement;

  return kind === 'number' ? toNumber(target.value) : target.value;
}

export function createIndexedFieldPath(
  collectionPath: string,
  index: number,
  key: string,
): FieldPath {
  return `${collectionPath}.${index}.${key}`;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
