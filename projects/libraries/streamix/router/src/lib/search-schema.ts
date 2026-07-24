type ScalarSchema =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | DateSchema;

type AnySchema =
  | ScalarSchema
  | ArraySchema
  | OptionalSchema<AnySchema>;

export type SearchSchema<T = unknown> =
  | ScalarSchema
  | ArraySchema
  | OptionalSchema<SearchSchema<T>>;

export type ParamSchema<T = unknown> =
  | ScalarSchema
  | OptionalSchema<ParamSchema<T>>;

interface StringSchema {
  readonly _type: 'string';
  readonly default?: string;
}

interface NumberSchema {
  readonly _type: 'number';
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
}

interface BooleanSchema {
  readonly _type: 'boolean';
  readonly default?: boolean;
}

interface ArraySchema {
  readonly _type: 'array';
  readonly default?: readonly string[];
}

interface DateSchema {
  readonly _type: 'date';
  readonly default?: Date;
}

interface OptionalSchema<T extends AnySchema> {
  readonly _type: 'optional';
  readonly inner: T;
}

export const s = {
  string: (defaultValue?: string): StringSchema => ({
    _type: 'string',
    default: defaultValue,
  }),

  number: (opts?: {
    default?: number;
    min?: number;
    max?: number;
  }): NumberSchema => ({
    _type: 'number',
    ...opts,
  }),

  boolean: (defaultValue?: boolean): BooleanSchema => ({
    _type: 'boolean',
    default: defaultValue,
  }),

  array: (defaultValue?: readonly string[]): ArraySchema => ({
    _type: 'array',
    default: defaultValue,
  }),

  date: (defaultValue?: Date): DateSchema => ({
    _type: 'date',
    default: defaultValue,
  }),

  optional: <T extends AnySchema>(inner: T): OptionalSchema<T> => ({
    _type: 'optional',
    inner,
  }),
} as const;

type SchemaValue<TSchema extends SearchSchema<unknown> | ParamSchema<unknown>> =
  TSchema extends OptionalSchema<infer TInner>
    ? SchemaValue<TInner>
    : TSchema extends StringSchema
      ? string
      : TSchema extends NumberSchema
        ? number
        : TSchema extends BooleanSchema
          ? boolean
          : TSchema extends ArraySchema
            ? readonly string[]
            : TSchema extends DateSchema
              ? Date
              : unknown;

export type InferSearchType<T extends Record<string, SearchSchema<unknown>>> = {
  [K in keyof T as T[K] extends OptionalSchema<SearchSchema<unknown>>
    ? never
    : K]: SchemaValue<T[K]>;
} & {
  [K in keyof T as T[K] extends OptionalSchema<SearchSchema<unknown>>
    ? K
    : never]?: SchemaValue<T[K]>;
};

export type InferParamType<T extends Record<string, ParamSchema<unknown>>> = {
  [K in keyof T as T[K] extends OptionalSchema<ParamSchema<unknown>>
    ? never
    : K]: SchemaValue<T[K]>;
} & {
  [K in keyof T as T[K] extends OptionalSchema<ParamSchema<unknown>>
    ? K
    : never]?: SchemaValue<T[K]>;
};

function parseValue(
  spec: SearchSchema<unknown> | ParamSchema<unknown>,
  raw: string | undefined,
): unknown {
  if (raw === undefined) {
    if (spec._type === 'optional') return undefined;
    return undefined;
  }

  switch (spec._type) {
    case 'string':
      return raw;
    case 'number': {
      const value = Number(raw);
      if (Number.isNaN(value)) {
        return spec.default ?? 0;
      }

      const min = spec.min ?? -Infinity;
      const max = spec.max ?? Infinity;
      return Math.max(min, Math.min(max, value));
    }
    case 'boolean':
      return raw === 'true' || raw === '1'
        ? true
        : raw === 'false' || raw === '0'
          ? false
          : (spec.default ?? false);
    case 'date': {
      const value = new Date(raw);
      return Number.isNaN(value.getTime()) ? (spec.default ?? new Date()) : value;
    }
    case 'optional':
      return parseValue(spec.inner, raw);
    default:
      return raw;
  }
}

function getDefault(spec: SearchSchema<unknown>): unknown {
  switch (spec._type) {
    case 'string':
      return spec.default ?? '';
    case 'number':
      return spec.default ?? 0;
    case 'boolean':
      return spec.default ?? false;
    case 'array':
      return Object.freeze([...(spec.default ?? [])]);
    case 'date':
      return spec.default ?? new Date();
    case 'optional':
      return undefined;
    default:
      return undefined;
  }
}

function getParamDefault(spec: ParamSchema<unknown>): unknown {
  switch (spec._type) {
    case 'string':
      return spec.default ?? '';
    case 'number':
      return spec.default ?? 0;
    case 'boolean':
      return spec.default ?? false;
    case 'date':
      return spec.default ?? new Date();
    case 'optional':
      return undefined;
    default:
      return undefined;
  }
}

function parseSearchInternal(
  schema: Record<string, SearchSchema<unknown>>,
  url: URL,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, spec] of Object.entries(schema)) {
    const allValues = url.searchParams.getAll(key);
    const raw = allValues[0];

    if (spec._type === 'array') {
      result[key] =
        allValues.length > 0
          ? Object.freeze([...allValues])
          : Object.freeze([...(spec.default ?? [])]);
      continue;
    }

    if (spec._type === 'optional' && raw === undefined) {
      continue;
    }

    const parsed = parseValue(spec, raw);
    result[key] = parsed !== undefined ? parsed : getDefault(spec);
  }

  return Object.freeze(result);
}

export function parseSearch<T extends Record<string, SearchSchema<unknown>>>(
  schema: T,
  url: URL,
): InferSearchType<T> {
  return parseSearchInternal(schema, url) as InferSearchType<T>;
}

export function parseSearchRecord(
  schema: Record<string, SearchSchema<unknown>>,
  url: URL,
): Record<string, unknown> {
  return parseSearchInternal(schema, url);
}

export function parseParams<T extends Record<string, ParamSchema<unknown>>>(
  schema: T,
  params: Record<string, string>,
): InferParamType<T> {
  const result: Record<string, unknown> = {};

  for (const [key, spec] of Object.entries(schema)) {
    const raw = params[key];

    if (spec._type === 'optional' && raw === undefined) {
      continue;
    }

    const parsed = parseValue(spec, raw);
    result[key] = parsed !== undefined ? parsed : getParamDefault(spec);
  }

  return Object.freeze(result) as InferParamType<T>;
}

export function parseParamsRecord(
  schema: Record<string, ParamSchema<unknown>>,
  params: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, spec] of Object.entries(schema)) {
    const raw = params[key];

    if (spec._type === 'optional' && raw === undefined) {
      continue;
    }

    const parsed = parseValue(spec, raw);
    result[key] = parsed !== undefined ? parsed : getParamDefault(spec);
  }

  return Object.freeze(result);
}

export function serializeSearch<T extends Record<string, SearchSchema<unknown>>>(
  schema: T,
  values: Partial<InferSearchType<T>>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }

    const spec = schema[key];
    if (!spec) {
      continue;
    }

    if (spec._type === 'array' && Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
      continue;
    }

    if (spec._type === 'date' && value instanceof Date) {
      params.set(key, value.toISOString());
      continue;
    }

    if (value !== getDefault(spec)) {
      params.set(key, String(value));
    }
  }

  const search = params.toString();
  return search ? `?${search}` : '';
}

function serializeValue(
  spec: SearchSchema<unknown> | ParamSchema<unknown>,
  value: unknown,
): string {
  if (spec._type === 'optional') {
    return serializeValue(spec.inner, value);
  }

  if (spec._type === 'date' && value instanceof Date) {
    return value.toISOString();
  }

  if (spec._type === 'boolean') {
    return value ? 'true' : 'false';
  }

  return String(value);
}

export function serializeParams<T extends Record<string, ParamSchema<unknown>>>(
  schema: T,
  values: InferParamType<T>,
): Record<string, string> {
  const params: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }

    const spec = schema[key];
    if (!spec) {
      params[key] = String(value);
      continue;
    }

    params[key] = serializeValue(spec, value);
  }

  return params;
}
