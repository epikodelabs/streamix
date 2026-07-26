export type PathNavigationTarget = {
  readonly path: string | URL;
};

export type NamedNavigationTarget<
  TName extends string = string,
  TParams = Record<string, unknown>,
  TQuery = Record<string, unknown>,
> = {
  readonly name: TName;
  readonly params?: TParams;
  readonly query?: TQuery;
};

/**
 * A discriminated union representing a navigation target.
 * Can be a raw URL string, a URL object, or an object specifying
 * a path or a named route with parameters.
 */
export type NavigationTarget =
  | string
  | URL
  | PathNavigationTarget
  | NamedNavigationTarget;