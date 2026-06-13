import { isPromiseLike, type MaybePromise } from '../abstractions';
import { flow, type AtomBase } from '../atoms/atom';

/**
 * Creates an atom that emits values in a loop based on a condition and an
 * iteration function.
 *
 * This operator is useful for generating a sequence of values until a specific
 * condition is no longer met. It starts with an `initialValue` and, for each
 * iteration, it yields the current value and then uses `iterateFn` to
 * calculate the next value in the sequence.
 *
 * @template T The type of the values in the atom.
 * @param initialValue The starting value for the loop.
 * @param condition A function that returns `true` to continue the loop and `false` to stop.
 * @param iterateFn A function that returns the next value in the sequence.
 * @returns {AtomBase<T | undefined>} An atom that emits the generated sequence of values.
 */
export function loop<T = any>(
  initialValue: MaybePromise<T>,
  condition: (value: T) => MaybePromise<boolean>,
  iterateFn: (value: T) => MaybePromise<T>
): AtomBase<T | undefined> {
  return flow<T | undefined>(
    async function* () {
      let currentValue = isPromiseLike(initialValue) ? await initialValue : initialValue;
      while (true) {
        const shouldContinue = condition(currentValue);
        const continueValue = isPromiseLike(shouldContinue) ? await shouldContinue : shouldContinue;
        if (!continueValue) break;
        yield currentValue;
        await Promise.resolve();
        const nextValue = iterateFn(currentValue);
        currentValue = isPromiseLike(nextValue) ? await nextValue : nextValue;
      }
    },
    undefined as unknown as T,
    { discrete: true }
  );
}
