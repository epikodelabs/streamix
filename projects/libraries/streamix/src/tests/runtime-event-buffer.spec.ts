import { RuntimeEventBuffer } from "../lib/runtime/event-buffer";

describe("runtime event buffer", () => {
  const done = { done: true, value: undefined } as IteratorResult<number>;

  it("serves concurrent waiters FIFO", async () => {
    const buffer = new RuntimeEventBuffer<number>();
    const first = buffer.wait();
    const second = buffer.wait();
    buffer.enqueue(0, { done: false, value: 1 });
    buffer.enqueue(1, { done: false, value: 2 });
    buffer.flush(false, done);
    expect((await first).value).toBe(1);
    expect((await second).value).toBe(2);
  });

  it("removes only detached source events", () => {
    const buffer = new RuntimeEventBuffer<number>();
    buffer.enqueue(0, { done: false, value: 1 });
    buffer.enqueue(1, { done: false, value: 2 });
    buffer.removeSource(0);
    expect(buffer.take()!.value).toBe(2);
    expect(buffer.hasEvents).toBe(false);
  });

  it("drains buffered events before completion", async () => {
    const buffer = new RuntimeEventBuffer<number>();
    buffer.enqueue(0, { done: false, value: 5 });
    const first = buffer.wait();
    const second = buffer.wait();
    buffer.flush(true, done);
    expect((await first).value).toBe(5);
    expect((await second).done).toBe(true);
  });

  it("cancellation releases pending reads immediately and drops buffered values", async () => {
    const buffer = new RuntimeEventBuffer<number>();
    const pending = buffer.wait();
    buffer.enqueue(0, { done: false, value: 3 });
    buffer.close(done);
    expect((await pending).done).toBe(true);
    expect(buffer.hasEvents).toBe(false);
    buffer.enqueue(0, { done: false, value: 4 });
    expect(buffer.hasEvents).toBe(false);
  });
});
