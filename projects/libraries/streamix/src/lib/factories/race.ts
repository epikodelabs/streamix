import { flow, type Atom } from "../atoms/atom";
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';
import { createAsyncCoordinator } from "../utils";
import { normalizeError } from "../atoms";

/**
 * Returns an atom that races multiple input sources.
 * It emits values from the first source that produces a value,
 * then cancels all other sources.
 *
 * This operator is useful for scenarios where you only need the result from the fastest
 * of several asynchronous operations. For example, fetching data from multiple servers
 * and only taking the result from the one that responds first.
 *
 * Once the winning source completes, the output atom also completes.
 * If the winning source emits an error, the output atom will emit that error.
 *
 * @template {readonly unknown[]} T - A tuple type representing the combined values from the sources.
 * @param streams Atoms, streams, or values (including promises) to race against each other.
 * @returns {Atom<T[number] >} A new atom that emits values from the first source to produce a value.
 */
export function race<T extends readonly unknown[] = any[]>(
  ...streams: { [K in keyof T]: PipeInput<T[K]> }
): Atom<T[number] > {
  return flow<T[number] >(async function* () {
    if (streams.length === 0) return;

    const iterators = streams.map(s =>
      toAsyncIterable(s)[Symbol.asyncIterator]() as AsyncIterator<T[number]>
    );
    const runner = createAsyncCoordinator<T[number]>(iterators);

    let hasWinner = false;

    try {
      while (true) {
        const result = await runner.next();
        if (result.done) break;

        const event = result.value;

        // 1. Handle errors immediately regardless of winner
        if (event.type === 'error') {
          throw normalizeError(event.error);
        }

        // 2. Identify the winner from the first real value or completion.
        if (!hasWinner) {
          hasWinner = true;
          await Promise.all(
            iterators.map((_, idx) =>
              idx !== event.sourceIndex ? runner.removeSource(idx) : undefined
            )
          );
        }

        // Loser events queued before the winner was selected are pruned by removeSource().
        if (event.type === 'value') {
          yield event.value;
        } else if (event.type === 'complete') {
          break;
        }
      }
    } finally {
      // Clean up the runner and all underlying iterators
      await runner.return?.();
    }
  });
}
