/**
 * A typed injection token.
 *
 * Tokens are opaque symbols with a phantom type parameter. They are used as
 * keys for dependency registration and resolution.
 *
 * @example
 * ```ts
 * const HttpClient = createToken<HttpClient>("HttpClient");
 * container.register(HttpClient, () => new FetchHttpClient());
 * const http = container.resolve(HttpClient);
 * ```
 */
export type Token<T> = symbol & { readonly __type: T };

/**
 * Creates a new typed injection token.
 *
 * @param name Human-readable name used for debugging and error messages.
 * @returns A unique token that can be used with a container.
 */
export function createToken<T>(name: string): Token<T> {
  return Symbol(`streamix:token:${name}`) as Token<T>;
}

/**
 * Extracts the value type of a {@link Token}.
 */
export type TokenValue<T> = T extends Token<infer V> ? V : never;
