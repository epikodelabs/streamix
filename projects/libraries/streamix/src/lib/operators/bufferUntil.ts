import {
  createOperator,
  getIteratorEmissionStamp,
  getIteratorMeta,
  setIteratorMeta,
  setValueMeta,
  type IteratorMetaTag,
  type Operator,
  type Stream
} from "../abstractions";
import { fromAny } from "../converters";

export const bufferUntil = <T = any>(notifier: Stream<any>) =>
  createOperator<T, T[]>("bufferUntil", function (this: Operator, source) {
    const notifierIterator = fromAny(notifier)[Symbol.asyncIterator]();

    const buffer: Array<{ value: T; meta?: any }> = [];

    type StampedEvent = {
      kind: "source" | "notifier";
      result: IteratorResult<any>;
      stamp: number;
    };

    const nextEvent = (it: AsyncIterator<any>, kind: StampedEvent["kind"]) =>
      Promise.resolve(it.next()).then(
        (result) => ({
          kind,
          result,
          stamp: getIteratorEmissionStamp(it) ?? Number.POSITIVE_INFINITY,
        }),
        (err) => {
          throw err;
        }
      ) as Promise<StampedEvent>;

    let iterator!: AsyncGenerator<T[]>;

    const flushBuffer = () => {
      if (buffer.length === 0) return null;

      const records = buffer.splice(0);
      const values = records.map((r) => r.value);
      const metas = records.map((r) => r.meta).filter(Boolean);
      const lastMeta = metas[metas.length - 1];

      if (lastMeta) {
        const metaData = {
          valueId: String(lastMeta.valueId),
          kind: "collapse" as const,
          inputValueIds: metas.map((m: any) => String(m.valueId)),
        } satisfies IteratorMetaTag;

        setIteratorMeta(
          iterator as any,
          metaData,
          lastMeta.operatorIndex,
          lastMeta.operatorName
        );

        setValueMeta(values, metaData, lastMeta.operatorIndex, lastMeta.operatorName);
      }

      return values;
    };

    const finalize = async () => {
      try {
        await source.return?.();
      } catch {}
      try {
        await notifierIterator.return?.();
      } catch {}
    };

    iterator = (async function* () {
      let notifierDone = false;
      let sourceDone = false;

      let sourcePending: Promise<StampedEvent> | null = nextEvent(source, "source");
      let notifierPending: Promise<StampedEvent> | null = nextEvent(
        notifierIterator,
        "notifier"
      );

      let sourceSlot: StampedEvent | null = null;
      let notifierSlot: StampedEvent | null = null;

      const tryNext = (source as any).__tryNext as
        | undefined
        | (() => IteratorResult<T> | null);

      const drainTryNext = () => {
        if (typeof tryNext !== "function") return;

        while (true) {
          const r = tryNext.call(source);
          if (!r) break;

          if (r.done) {
            sourceDone = true;
            break;
          }

          // ✅ READ META FROM THE ITERATOR THAT YIELDED
          const meta = getIteratorMeta(source);

          buffer.push({
            value: r.value,
            meta,
          });
        }
      };

      const pushSourceEvent = (event: StampedEvent) => {
        if (event.result.done) {
          sourceDone = true;
          return;
        }

        // ✅ SAME RULE HERE
        const meta = getIteratorMeta(source);

        buffer.push({
          value: event.result.value,
          meta,
        });
      };

      const microtaskTimeout = async (turns: number) => {
        for (let i = 0; i < turns; i++) await Promise.resolve();
        return Symbol("timeout");
      };

      const withMicrotaskBudget = async <TValue>(
        promise: Promise<TValue>,
        turns: number
      ): Promise<TValue | symbol> => {
        const timeout = microtaskTimeout(turns);
        return Promise.race([promise, timeout]);
      };

      const MICROTASK_BUDGET = 12;

      const catchUpSourceToStamp = async (stampLimit: number) => {
        drainTryNext();

        while (!sourceDone) {
          if (sourceSlot) {
            if (sourceSlot.stamp <= stampLimit) {
              const e = sourceSlot;
              sourceSlot = null;
              pushSourceEvent(e);
              drainTryNext();
              continue;
            }
            break;
          }

          if (!sourcePending) sourcePending = nextEvent(source, "source");

          // Give the source a small bounded microtask window to resolve.
          // This covers cases where the upstream value is already buffered but
          // an async-wrapper operator (e.g. `async next() { await ... }`) delays
          // the resolution by a few microtasks.
          const raced = await withMicrotaskBudget(sourcePending, MICROTASK_BUDGET);
          if (typeof raced === "symbol") break;
          const maybe = raced as StampedEvent;
          sourcePending = null;

          if (maybe.stamp <= stampLimit) {
            pushSourceEvent(maybe);
            drainTryNext();
            continue;
          }

          sourceSlot = maybe;
          break;
        }
      };

      try {
        while (true) {
          drainTryNext();

          if (sourceDone) {
            const flushed = flushBuffer();
            if (flushed) yield flushed;
            return;
          }

          if (!sourceSlot && !notifierSlot) {
            const racers: Promise<StampedEvent>[] = [];

            if (!sourceDone) {
              if (!sourcePending) sourcePending = nextEvent(source, "source");
              racers.push(sourcePending);
            }

            if (!notifierDone) {
              if (!notifierPending) {
                notifierPending = nextEvent(notifierIterator, "notifier");
              }
              racers.push(notifierPending);
            }

            const event = await Promise.race(racers);
            if (event.kind === "source") {
              sourceSlot = event;
              sourcePending = null;
            } else {
              notifierSlot = event;
              notifierPending = null;
            }
          }

          if (notifierSlot && !sourceSlot && !sourceDone) {
            if (!sourcePending) sourcePending = nextEvent(source, "source");

            const raced = await withMicrotaskBudget(sourcePending, MICROTASK_BUDGET);
            if (typeof raced !== "symbol") {
              sourceSlot = raced as StampedEvent;
              sourcePending = null;
            }
          }

          const processSource =
            !!sourceSlot &&
            (!notifierSlot || sourceSlot.stamp <= notifierSlot.stamp);

          if (processSource) {
            const event = sourceSlot!;
            sourceSlot = null;

            if (event.result.done) {
              sourceDone = true;
              const flushed = flushBuffer();
              if (flushed) yield flushed;
              return;
            }

            pushSourceEvent(event);
            continue;
          }

          if (notifierSlot) {
            const event = notifierSlot;
            notifierSlot = null;

            if (event.result.done) {
              notifierDone = true;
              continue;
            }

            await catchUpSourceToStamp(event.stamp);

            const flushed = flushBuffer();
            if (flushed) yield flushed;
          }
        }
      } catch (err: any) {
        await finalize();
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        await finalize();
      }
    })();

    return iterator;
  });
