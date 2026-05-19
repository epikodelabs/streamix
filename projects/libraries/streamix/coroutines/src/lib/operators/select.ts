import type { Channel, ReceiveResult } from "./channel";
import { background, createAbortError, Context, ContextCancelledError } from "./context";

export type SelectReceiveCase<T = any> = {
  op: "receive";
  channel: Channel<T>;
  name?: string;
};

export type SelectSendCase<T = any> = {
  op: "send";
  channel: Channel<T>;
  value: T;
  name?: string;
};

export type SelectDefaultCase = {
  op: "default";
  name?: string;
};

export type SelectCase<T = any> = SelectReceiveCase<T> | SelectSendCase<T> | SelectDefaultCase;

export type SelectResult<T = any> = {
  index: number;
  case: SelectCase<T>;
  op: SelectCase<T>["op"];
  name?: string;
  value?: T;
  ok?: boolean;
};

export const recv = <T>(ch: Channel<T>, name?: string): SelectReceiveCase<T> => ({ op: "receive", channel: ch, name });
export const send = <T>(ch: Channel<T>, value: T, name?: string): SelectSendCase<T> => ({ op: "send", channel: ch, value, name });
export const otherwise = (name = "default"): SelectDefaultCase => ({ op: "default", name });

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
