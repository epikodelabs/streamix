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
 * The input type is inferred from the first operator. Up to 16 operators
 * are fully typed via overloads; beyond that the generic fallback is used.
 *
 * @example
 * ```ts
 * const searchPipeline = compose(
 *   debounce(300),
 *   distinctUntilChanged(),
 *   switchMap(search)
 * );
 *
 * pipe(query, searchPipeline);
 * ```
 *
 * @returns A single {@link Operator} that runs the composed chain.
 */
export function compose<T = any>(): Operator<T, T>;
export function compose<T, A>(op1: Operator<T, A>): Operator<T, A>;
export function compose<T, A, B>(op1: Operator<T, A>, op2: Operator<A, B>): Operator<T, B>;
export function compose<T, A, B, C>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>): Operator<T, C>;
export function compose<T, A, B, C, D>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>): Operator<T, D>;
export function compose<T, A, B, C, D, E>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>): Operator<T, E>;
export function compose<T, A, B, C, D, E, F>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>): Operator<T, F>;
export function compose<T, A, B, C, D, E, F, G>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>): Operator<T, G>;
export function compose<T, A, B, C, D, E, F, G, H>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>): Operator<T, H>;
export function compose<T, A, B, C, D, E, F, G, H, I>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>): Operator<T, I>;
export function compose<T, A, B, C, D, E, F, G, H, I, J>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>): Operator<T, J>;
export function compose<T, A, B, C, D, E, F, G, H, I, J, K>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>): Operator<T, K>;
export function compose<T, A, B, C, D, E, F, G, H, I, J, K, L>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>): Operator<T, L>;
export function compose<T, A, B, C, D, E, F, G, H, I, J, K, L, M>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>): Operator<T, M>;
export function compose<T, A, B, C, D, E, F, G, H, I, J, K, L, M, N>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>, op14: Operator<M, N>): Operator<T, N>;
export function compose<T, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>, op14: Operator<M, N>, op15: Operator<N, O>): Operator<T, O>;
export function compose<T, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>, op14: Operator<M, N>, op15: Operator<N, O>, op16: Operator<O, P>): Operator<T, P>;
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