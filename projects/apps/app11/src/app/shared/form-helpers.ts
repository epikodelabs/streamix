export type FieldPath = string;
export type FieldValueKind = 'text' | 'number' | 'boolean';
export type FormValuePrimitive = string | number | boolean;

export function readFormPath<T = unknown>(
  source: unknown,
  path: FieldPath,
): T {
  return path
    .split('.')
    .reduce<any>((current, key) => current?.[key], source) as T;
}

export function writeFormPath(
  source: any,
  path: FieldPath,
  value: unknown,
): void {
  const parts = path.split('.');

  if (parts.some(isIndexSegment)) {
    const [rootKey, ...rest] = parts;
    const rootClone = structuredClone(source[rootKey]);
    assignPathValue(rootClone, rest, value);
    source[rootKey] = rootClone;
    return;
  }

  assignPathValue(source, parts, value);
}

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

export function remapIndexedFieldPaths(
  paths: FieldPath[],
  collectionPath: string,
  removedIndex: number,
): FieldPath[] {
  const prefix = `${collectionPath}.`;

  return paths.flatMap((path) => {
    if (!path.startsWith(prefix)) {
      return [path];
    }

    const parts = path.split('.');
    const indexOffset = collectionPath.split('.').length;
    const itemIndex = Number(parts[indexOffset]);

    if (itemIndex === removedIndex) {
      return [];
    }

    if (itemIndex > removedIndex) {
      parts[indexOffset] = String(itemIndex - 1);
      return [parts.join('.')];
    }

    return [path];
  });
}

export function shouldShowFieldError(
  path: FieldPath,
  touchedFields: FieldPath[],
  attemptedSubmit: boolean,
): boolean {
  return attemptedSubmit || touchedFields.includes(path);
}

function assignPathValue(
  source: any,
  parts: string[],
  value: unknown,
): void {
  const last = parts.pop();

  if (!last) {
    return;
  }

  const target = parts.reduce((current, key) => current[key], source);
  target[last] = value;
}

function isIndexSegment(value: string): boolean {
  return /^\d+$/.test(value);
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
