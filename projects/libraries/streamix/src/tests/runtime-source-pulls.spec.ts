import { RuntimeSourcePulls } from "../lib/runtime/source-pulls";

describe("runtime source pulls", () => {
  it("ignores a stale result after reusing a source index", async () => {
    let resolveOld!: (value: IteratorResult<number>) => void;
    const oldSource: AsyncIterator<number> = { next: () => new Promise(resolve => { resolveOld = resolve; }) };
    const source = new RuntimeSourcePulls<number>();
    const values: number[] = [];
    source.attach(0, oldSource);
    source.request(0, r => values.push(r.value), () => fail("unexpected failure"));
    source.detach(0);
    source.attach(0, { next: async () => ({ done: false, value: 2 }) });
    source.request(0, r => values.push(r.value), () => fail("unexpected failure"));
    resolveOld({ done: false, value: 1 });
    await Promise.resolve(); await Promise.resolve();
    expect(values).toEqual([2]);
  });

  it("never overlaps pulls for the same source", async () => {
    let resolve!: (value: IteratorResult<number>) => void;
    let calls = 0;
    const pulls = new RuntimeSourcePulls<number>();
    pulls.attach(0, { next: () => { calls++; return new Promise(r => { resolve = r; }); } });
    pulls.request(0, () => {}, () => {});
    pulls.request(0, () => {}, () => {});
    expect(calls).toBe(1);
    resolve({ done: false, value: 1 });
    await Promise.resolve();
    expect(pulls.isPulling(0)).toBe(false);
  });

  it("ignores results after closing", async () => {
    let resolve!: (value: IteratorResult<number>) => void;
    const pulls = new RuntimeSourcePulls<number>();
    const values: number[] = [];
    pulls.attach(0, { next: () => new Promise(r => { resolve = r; }) });
    pulls.request(0, r => values.push(r.value), () => {});
    pulls.close();
    resolve({ done: false, value: 5 });
    await Promise.resolve();
    expect(values).toEqual([]);
  });
});
