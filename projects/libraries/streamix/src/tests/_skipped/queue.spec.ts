import { createQueue } from "@epikodelabs/streamix";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createQueue", () => {
  it("runs operations sequentially in enqueue order", async () => {
    const queue = createQueue();
    const order: string[] = [];
    const gate = defer<void>();

    const first = queue.enqueue(async () => {
      order.push("start1");
      await gate.promise;
      order.push("end1");
      return 1;
    });

    const second = queue.enqueue(async () => {
      order.push("start2");
      order.push("end2");
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(["start1"]);

    gate.resolve();
    await first;
    await second;

    expect(order).toEqual(["start1", "end1", "start2", "end2"]);
  });

  it("tracks pending and isEmpty as work progresses", async () => {
    const queue = createQueue();
    const gate1 = defer<void>();
    const gate2 = defer<void>();

    expect(queue.isEmpty).toBe(true);

    const first = queue.enqueue(async () => {
      await gate1.promise;
    });

    const second = queue.enqueue(async () => {
      await gate2.promise;
    });

    expect(queue.pending).toBe(2);
    expect(queue.isEmpty).toBe(false);

    gate1.resolve();
    await first;
    await Promise.resolve();

    expect(queue.pending).toBe(1);
    expect(queue.isEmpty).toBe(false);

    gate2.resolve();
    await second;

    expect(queue.pending).toBe(0);
    expect(queue.isEmpty).toBe(true);
  });

  it("continues after a rejected operation", async () => {
    const queue = createQueue();
    const order: string[] = [];

    const first = queue.enqueue(async () => {
      order.push("first");
      throw new Error("fail");
    });

    const second = queue.enqueue(async () => {
      order.push("second");
    });

    await first.catch(() => {});
    await second;

    expect(order).toEqual(["first", "second"]);
  });
});
