import { isPromiseLike, type MaybePromise, type Operator } from "../abstractions";
import { flow, type AtomBase } from "../atoms/atom";

/**
 * Anything that can be used as the source of an atom pipeline.
 */
export type StreamInput<T = any> =
  | AtomBase<T>
  | AsyncIterable<T>
  | Iterable<T>
  | MaybePromise<T>
  | T;



function isAtomLike(value: unknown): value is AtomBase<any> {
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
export function toAsyncIterable<T>(source: StreamInput<T>): AsyncIterable<T> {
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

function combineAtoms<T extends unknown[]>(sources: AtomBase<any>[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const values = sources.map((s) => s.value);
      let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
      let done = false;

      const subs = sources.map((s, i) =>
        s.subscribe((v) => {
          values[i] = v;
          if (resolveNext) {
            resolveNext({ value: values.slice() as T, done: false });
            resolveNext = null;
          }
        })
      );

      return {
        async next() {
          if (done) return { value: undefined, done: true } as IteratorResult<T>;
          return new Promise<IteratorResult<T>>((resolve) => {
            resolveNext = resolve;
          });
        },
        return() {
          done = true;
          subs.forEach((s) => s.unsubscribe());
          return Promise.resolve({ value: undefined, done: true } as IteratorResult<T>);
        },
      };
    },
  };
}

/**
 * Builds an atom pipeline from any supported source.
 *
 * Operators are applied to the source's async iterator and the result is
 * landed back into an atom.
 *
 * @param source The source for the pipeline, or an array of atoms to combine.
 * @param ops Operators to apply.
 * @returns A new {@link AtomBase}.
 */
export function pipe<T>(source: StreamInput<T>): AtomBase<T>;
export function pipe<T, A>(source: StreamInput<T>, op1: Operator<T, A>): AtomBase<A>;
export function pipe<T, A, B>(source: StreamInput<T>, op1: Operator<T, A>, op2: Operator<A, B>): AtomBase<B>;
export function pipe<T, A, B, C>(source: StreamInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>): AtomBase<C>;
export function pipe<T, A, B, C, D>(source: StreamInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>): AtomBase<D>;
export function pipe<T, A, B, C, D, E>(source: StreamInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>): AtomBase<E>;
export function pipe<T, A, B, C, D, E, F>(source: StreamInput<T>, op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>): AtomBase<F>;
export function pipe<T extends readonly unknown[]>(sources: [...{ [K in keyof T]: AtomBase<T[K]> }]): AtomBase<T>;
export function pipe<T>(source: StreamInput<T>, ...ops: Operator[]): AtomBase<any>;
export function pipe(
  source: StreamInput<any> | AtomBase<any>[],
  ...ops: Operator[]
): AtomBase<any> {
  let iterable: AsyncIterable<any>;

  if (Array.isArray(source) && source.every(isAtomLike)) {
    iterable = combineAtoms(source);
  } else {
    iterable = toAsyncIterable(source as StreamInput<any>);
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
