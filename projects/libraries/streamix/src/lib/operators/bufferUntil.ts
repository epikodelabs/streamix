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

      // IMPORTANT: do NOT eagerly call `it.next()` when `__tryNext` exists.
      // Eager `next()` would consume the first buffered item, and then a
      // subsequent `__tryNext()` drain would start from the *second* item,
      // causing output reordering like [2,1].
      let sourcePending: Promise<StampedEvent> | null = null;
      let notifierPending: Promise<StampedEvent> | null = null;

      let sourceSlot: StampedEvent | null = null;
      let notifierSlot: StampedEvent | null = null;

      const tryNext = (source as any).__tryNext as
        | undefined
        | (() => IteratorResult<T> | null);

      const notifierTryNext = (notifierIterator as any).__tryNext as
        | undefined
        | (() => IteratorResult<any> | null);

      const takeSourceSync = (): StampedEvent | null => {
        if (typeof tryNext !== "function") return null;
        const r = tryNext.call(source);
        if (!r) return null;
        return {
          kind: "source",
          result: r,
          stamp: getIteratorEmissionStamp(source) ?? Number.POSITIVE_INFINITY,
        };
      };

      const takeNotifierSync = (): StampedEvent | null => {
        if (typeof notifierTryNext !== "function") return null;
        const r = notifierTryNext.call(notifierIterator);
        if (!r) return null;
        return {
          kind: "notifier",
          result: r,
          stamp: getIteratorEmissionStamp(notifierIterator) ?? Number.POSITIVE_INFINITY,
        };
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
        while (!sourceDone) {
          if (!sourceSlot) {
            // If we have an in-flight `next()` promise, do NOT consult `__tryNext()`.
            // `__tryNext()` can see later terminal events (DONE) that were queued
            // after the pending pull was satisfied, which would cause us to
            // complete before processing the pending value.
            const sync = !sourcePending ? takeSourceSync() : null;
            if (sync) {
              sourceSlot = sync;
            } else {
              if (!sourcePending) sourcePending = nextEvent(source, "source");
              const raced = await withMicrotaskBudget(sourcePending, MICROTASK_BUDGET);
              if (typeof raced === "symbol") return;
              sourcePending = null;
              sourceSlot = raced as StampedEvent;
            }
          }

          if (!sourceSlot) return;
          if (sourceSlot.stamp > stampLimit) return;

          const e = sourceSlot;
          sourceSlot = null;
          if (e.result.done) {
            sourceDone = true;
            return;
          }
          pushSourceEvent(e);
        }
      };

      try {
        while (true) {
          // Fill slots from synchronous buffers first.
          if (!sourceSlot && !sourceDone) {
            const sync = !sourcePending ? takeSourceSync() : null;
            if (sync) sourceSlot = sync;
          }
          if (!notifierSlot && !notifierDone) {
            const sync = !notifierPending ? takeNotifierSync() : null;
            if (sync) notifierSlot = sync;
          }

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
