import type { Channel, ReceiveResult } from "./channel";
import { background, createAbortError, Context, ContextCancelledError } from "./context";

/**
 * Represents a `select` case that receives a value from a channel.
 *
 * @template T The type of value received from the channel.
 */
export type SelectReceiveCase<T = any> = {
  op: "receive";
  channel: Channel<T>;
  name?: string;
};

/**
 * Represents a `select` case that sends a value into a channel.
 *
 * @template T The type of value sent to the channel.
 */
export type SelectSendCase<T = any> = {
  op: "send";
  channel: Channel<T>;
  value: T;
  name?: string;
};

/**
 * Represents a default `select` case that fires when no other case is ready.
 */
export type SelectDefaultCase = {
  op: "default";
  name?: string;
};

/**
 * A union of all possible `select` cases.
 *
 * @template T The channel value type.
 */
export type SelectCase<T = any> = SelectReceiveCase<T> | SelectSendCase<T> | SelectDefaultCase;

/**
 * Result of a `select` operation indicating which case was chosen.
 *
 * @template T The channel value type.
 */
export type SelectResult<T = any> = {
  index: number;
  case: SelectCase<T>;
  op: SelectCase<T>["op"];
  name?: string;
  value?: T;
  ok?: boolean;
};

/**
 * Builds a receive case for use with `select(...)`.
 *
 * @template T The channel value type.
 * @param ch The channel to receive from.
 * @param name Optional identifier for this case.
 * @returns A `SelectReceiveCase`.
 */
export const recv = <T>(ch: Channel<T>, name?: string): SelectReceiveCase<T> => ({ op: "receive", channel: ch, name });

/**
 * Builds a send case for use with `select(...)`.
 *
 * @template T The channel value type.
 * @param ch The channel to send into.
 * @param value The value to send.
 * @param name Optional identifier for this case.
 * @returns A `SelectSendCase`.
 */
export const send = <T>(ch: Channel<T>, value: T, name?: string): SelectSendCase<T> => ({ op: "send", channel: ch, value, name });

/**
 * Builds a default case for use with `select(...)`.
 *
 * @param name Optional identifier for this case.
 * @returns A `SelectDefaultCase`.
 */
export const otherwise = (name = "default"): SelectDefaultCase => ({ op: "default", name });

/**
 * Waits on multiple channel operations simultaneously and returns the first one that is ready.
 *
 * If a default case is provided and no channel operation is immediately available,
 * the default case is selected without blocking.
 *
 * @template T The channel value type.
 * @param cases An array of select cases (receive, send, or default).
 * @param ctx A cancellation context. Defaults to `background()`.
 * @returns A `SelectResult` describing which case was chosen and its value.
 */
export async function select<T = any>(cases: SelectCase<T>[], ctx: Context = background()): Promise<SelectResult<T>> {
  if (ctx.signal.aborted) throw createAbortError(ctx.signal);

  const defaultIndex = cases.findIndex((item) => item.op === "default");

  for (let index = 0; index < cases.length; index++) {
    const item = cases[index];
    if (item.op === "receive") {
      const result = item.channel.tryReceive();
      if (result) {
        return { index, case: item, op: item.op, name: item.name, value: result.value, ok: result.ok };
      }
    } else if (item.op === "send") {
      if (item.channel.trySend(item.value)) {
        return { index, case: item, op: item.op, name: item.name, ok: true };
      }
    }
  }

  if (defaultIndex >= 0) {
    const item = cases[defaultIndex];
    return { index: defaultIndex, case: item, op: item.op, name: item.name, ok: true };
  }

  const controllers = cases.map(() => new AbortController());
  const abortAll = () => controllers.forEach((controller) => {
    if (!controller.signal.aborted) controller.abort(new ContextCancelledError("select case lost"));
  });

  const onContextAbort = () => abortAll();
  ctx.signal.addEventListener("abort", onContextAbort, { once: true });

  // NOTE: Promise.race can leave other cases in a pending state where they may
  // still advance (e.g., consume a channel value) before abortAll() runs in
  // finally. This is an inherent limitation of racing async channel ops.

  try {
    return await Promise.race(
      cases.map(async (item, index): Promise<SelectResult<T>> => {
        const signal = controllers[index].signal;
        if (item.op === "receive") {
          const result: ReceiveResult<T> = await item.channel.receive(signal);
          return { index, case: item, op: item.op, name: item.name, value: result.value, ok: result.ok };
        }
        if (item.op === "send") {
          await item.channel.send(item.value, signal);
          return { index, case: item, op: item.op, name: item.name, ok: true };
        }
        return { index, case: item, op: item.op, name: item.name, ok: true };
      })
    );
  } finally {
    ctx.signal.removeEventListener("abort", onContextAbort);
    abortAll();
    if (ctx.signal.aborted) throw createAbortError(ctx.signal);
  }
}
