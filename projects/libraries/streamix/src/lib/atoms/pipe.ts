import { flow, type Atom } from "./atom";
import { isPromiseLike, type MaybePromise, type Operator } from "./operator";

/**
 * Anything that can be used as the source of an atom pipeline.
 */
export type PipeInput<T = any> =
  | Atom<T>
  | AsyncIterable<T>
  | Iterable<T>
  | MaybePromise<T>
  | T;



function isAtomLike(value: unknown): value is Atom<any> {
  return value != null && (value as any).type === "atom";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<any> {
  return value != null && typeof (value as any)[Symbol.asyncIterator] === "function";
}

function isIterable(value: unknown): value is Iterable<any> {
  return value != null && typeof (value as any)[Symbol.iterator] === "function";
}

/**
 * Normalizes a supported source into an async iterable.
 */
export function toAsyncIterable<T>(source: PipeInput<T>): AsyncIterable<T> {
  if (isAtomLike(source)) {
    return source as AsyncIterable<T>;
  }

  if (isAsyncIterable(source)) {
    return source;
  }

  if (isIterable(source)) {
    return (async function* () {
      for (const item of source as Iterable<T>) {
        yield item;
      }
    })();
  }

  if (isPromiseLike(source)) {
    return (async function* () {
      const resolved = await source;
      if (isAtomLike(resolved)) {
        for await (const item of toAsyncIterable(resolved)) {
          yield item;
        }
        return;
      }
      if (isAsyncIterable(resolved)) {
        for await (const item of resolved) {
          yield item;
        }
        return;
      }
      yield resolved;
    })();
  }

  return (async function* () {
    yield source;
  })();
}

function combineAtoms<T extends unknown[]>(sources: Atom<any>[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const values = sources.map((s) => s.value);
      const queue: T[] = [];
      let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
      let done = false;

      const subs = sources.map((s, i) =>
        s.subscribe((v) => {
          values[i] = v;
          const emitted = values.slice() as T;
          if (resolveNext) {
            resolveNext({ value: emitted, done: false });
            resolveNext = null;
          } else {
            queue.push(emitted);
          }
        })
      );

      return {
        async next() {
          if (done) return { value: undefined, done: true } as IteratorResult<T>;
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            resolveNext = resolve;
          });
        },
        return() {
          done = true;
          subs.forEach((s) => s.unsubscribe());
          queue.length = 0;
          return Promise.resolve({ value: undefined, done: true } as IteratorResult<T>);
        },
      };
    },
  };
}

/**
 * Builds an atom pipeline from a supported source.
 *
 * Applies a chain of operators to a single {@link PipeInput} and lands the
 * result back into an atom.
 *
 * ```ts
 * const evens = pipe(
 *   range(1, 20),
 *   filter(n => n % 2 === 0),
 *   map(n => n * 10)
 * );
 * ```
 *
 * You can also pass a tuple of atoms to combine them into a single atom whose
 * values are tuples:
 *
 * ```ts
 * const combined = pipe([atom(1), atom('hello')]); // Atom<[number, string]>
 * ```
 *
 * Up to 16 operators are fully typed via overloads. Beyond 16 operators, TypeScript
 * falls back to the generic signature and the result type becomes `Atom<any>`.
 *
 * @param source - The source for the pipeline, or a tuple of atoms to combine.
 * @param operators - Operators to apply to the source.
 * @returns A new {@link Atom} that emits the transformed values.
 */
export function pipe<T extends readonly unknown[]>(sources: [...{ [K in keyof T]: Atom<T[K]> }]): Atom<T>;
export function pipe<T>(source: PipeInput<T>): Atom<T>;
export function pipe<T, A>(source: PipeInput<T>, op1: Operator<T, A>): Atom<A>;
export function pipe<T, A, B>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>): Atom<B>;
export function pipe<T, A, B, C>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>): Atom<C>;
export function pipe<T, A, B, C, D>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>): Atom<D>;
export function pipe<T, A, B, C, D, E>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>): Atom<E>;
export function pipe<T, A, B, C, D, E, F>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>): Atom<F>;
export function pipe<T, A, B, C, D, E, F, G>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>): Atom<G>;
export function pipe<T, A, B, C, D, E, F, G, H>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>): Atom<H>;
export function pipe<T, A, B, C, D, E, F, G, H, I>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>): Atom<I>;
export function pipe<T, A, B, C, D, E, F, G, H, I, J>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>): Atom<J>;
export function pipe<T, A, B, C, D, E, F, G, H, I, J, K>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>): Atom<K>;
export function pipe<T, A, B, C, D, E, F, G, H, I, J, K, L>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>): Atom<L>;
export function pipe<T, A, B, C, D, E, F, G, H, I, J, K, L, M>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>): Atom<M>;
export function pipe<T, A, B, C, D, E, F, G, H, I, J, K, L, M, N>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>, op14: Operator<M, N>): Atom<N>;
export function pipe<T, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>, op14: Operator<M, N>, op15: Operator<N, O>): Atom<O>;
export function pipe<T, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P>(source: PipeInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>, op14: Operator<M, N>, op15: Operator<N, O>, op16: Operator<O, P>): Atom<P>;
export function pipe<T>(source: PipeInput<T>, ...ops: Operator[]): Atom<any>;
export function pipe(
  source: PipeInput<any> | Atom<any>[],
  ...ops: Operator[]
): Atom<any> {
  let iterable: AsyncIterable<any>;

  if (Array.isArray(source) && source.every(isAtomLike)) {
    iterable = combineAtoms(source);
  } else {
    iterable = toAsyncIterable(source as PipeInput<any>);
  }

  let iterator: AsyncIterator<any> = iterable[Symbol.asyncIterator]();

  for (const op of ops) {
    iterator = op.apply(iterator);
  }

  const resultIterable: AsyncIterable<any> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };

  return flow(resultIterable);
}
