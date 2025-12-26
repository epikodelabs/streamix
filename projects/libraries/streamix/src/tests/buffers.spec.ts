import {
  createBehaviorSubjectBuffer,
  createReplayBuffer,
  createSubjectBuffer,
} from "@epikodelabs/streamix";

describe("createSubjectBuffer", () => {
  it("peek returns done:true after completion when reader is caught up", async () => {
    const buf = createSubjectBuffer<number>();
    const r = await buf.attachReader();

    await buf.write(1);
    const first = await buf.read(r);
    expect(first).toEqual({ value: 1, done: false });

    await buf.complete();
    const p = await buf.peek(r);
    expect(p).toEqual({ value: undefined, done: true });
  });

  it("peek returns done:false with undefined value while waiting", async () => {
    const buf = createSubjectBuffer<number>();
    const r = await buf.attachReader();

    const p = await buf.peek(r);
    expect(p.done).toBeFalse();
    expect(p.value).toBeUndefined();
  });

  it("completed returns true after an error is consumed", async () => {
    const buf = createSubjectBuffer<number>();
    const r = await buf.attachReader();

    await buf.write(1);
    await buf.read(r);

    await buf.error(new Error("E"));

    try {
      await buf.read(r);
      fail("Expected read to throw");
    } catch (err: any) {
      expect(err).toEqual(jasmine.any(Error));
      expect(err.message).toBe("E");
    }

    expect(buf.completed(r)).toBeTrue();
  });

  it("read waits for data and resolves after write", async () => {
    const buf = createSubjectBuffer<number>();
    const r = await buf.attachReader();

    const pending = buf.read(r);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await buf.write(123);

    const res = await pending;
    expect(res).toEqual({ value: 123, done: false });
  });
});

describe("createBehaviorSubjectBuffer", () => {
  it("attachReader works without an initial value", async () => {
    const buf = createBehaviorSubjectBuffer<number>();
    const r = await buf.attachReader();

    expect(buf.value).toBeUndefined();
    expect(buf.completed(r)).toBeFalse();
  });

  it("completed does not treat undefined initial value as 'awaiting initial'", async () => {
    const buf = createBehaviorSubjectBuffer<number | undefined>(Promise.resolve(undefined));
    const r = await buf.attachReader();

    expect(buf.completed(r)).toBeFalse();
  });

  it("read waits for the next value after initial is consumed", async () => {
    const buf = createBehaviorSubjectBuffer<number>(0);
    const r = await buf.attachReader();

    await buf.read(r); // consume initial

    const pending = buf.read(r);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await buf.write(1);

    const res = await pending;
    expect(res.value).toBe(1);
  });
});

describe("createReplayBuffer", () => {
  it("buffer getter is safe before initialization", () => {
    const rb = createReplayBuffer<number>(2);
    expect(rb.buffer).toEqual([]);
  });

  it("infinite capacity returns full history", async () => {
    const rb = createReplayBuffer<number>(Infinity);
    await rb.write(1);
    await rb.write(2);
    await rb.write(3);

    expect(rb.buffer).toEqual([1, 2, 3]);
  });

  it("read waits for data and resolves after write", async () => {
    const rb = createReplayBuffer<number>(2);
    const r = await rb.attachReader();

    const pending = rb.read(r);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await rb.write(7);

    const res = await pending;
    expect(res.value).toBe(7);
  });
});


