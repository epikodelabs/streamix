import { createOperator, Operator, ValidateChain } from "./operator";

/**
 * Extracts the input type of an operator.
 */
export type OperatorInput<O> =
  O extends Operator<infer T, any>
    ? T
    : never;

/**
 * Extracts the output type of an operator.
 */
export type OperatorOutput<O> =
  O extends Operator<any, infer R>
    ? R
    : never;

/**
 * Computes the resulting operator type after composition.
 */
export type ComposeResult<
  T,
  Ops extends readonly Operator<any, any>[]
> =
  Ops extends []
    ? Operator<T, T>
    : Ops extends [Operator<T, infer A>, ...infer Rest]
      ? Rest extends readonly Operator<any, any>[]
        ? ComposeResult<A, Rest> extends Operator<any, infer R>
          ? Operator<T, R>
          : never
        : Operator<T, A>
      : never;

/**
 * Composes multiple operators into a single reusable operator.
 *
 * Example:
 *
 * const searchPipeline = compose(
 *   debounce(300),
 *   distinct(),
 *   switchMap(search)
 * );
 *
 * pipe(query, searchPipeline);
 */
export function compose<
  T,
  Ops extends readonly Operator<any, any>[]
>(
  ...operators: Ops & ValidateChain<T, Ops>
): ComposeResult<T, Ops> {
  const name =
    operators
      .map(op => op.name)
      .filter(Boolean)
      .join(" → ") || "compose";

  return createOperator(
    name,
    source => {
      let current: AsyncIterator<any> = source;

      for (const operator of operators) {
        current = operator.apply(current);
      }

      return current;
    }
  ) as ComposeResult<T, Ops>;
}