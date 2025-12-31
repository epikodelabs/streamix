import { createLock } from "@epikodelabs/streamix";

describe("createLock", () => {
  it("allows only one holder at a time", async () => {
    const lock = createLock();
    const release1 = await lock();
    let acquired2 = false;

    const second = lock().then((release2) => {
      acquired2 = true;
      release2();
    });

    await Promise.resolve();
    expect(acquired2).toBe(false);

    release1();
    await second;

    expect(acquired2).toBe(true);
  });

  it("unblocks waiters in FIFO order", async () => {
    const lock = createLock();
    const release1 = await lock();
    const order: number[] = [];

    const second = lock().then((release2) => {
      order.push(2);
      release2();
    });

    const third = lock().then((release3) => {
      order.push(3);
      release3();
    });

    await Promise.resolve();
    expect(order).toEqual([]);

    release1();
    await second;
    await third;

    expect(order).toEqual([2, 3]);
  });
});
