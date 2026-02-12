import {
    createAsyncCoordinator, DONE, getIteratorEmissionStamp,
    setIteratorEmissionStamp
} from "@epikodelabs/streamix";

describe("runner", () => {
    // Helper to create a standard async generator
    async function* delayedSource<T>(items: T[], delayMs: number) {
        for (const item of items) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            yield item;
        }
    }

    it("should interleave values from multiple async sources based on timing", async () => {
        const source0 = delayedSource(["A", "C"], 50);
        const source1 = delayedSource(["B"], 75);

        const runner = createAsyncCoordinator([source0, source1]);
        const results: any[] = [];

        let res = await runner.next();
        while (!res.done) {
            results.push(res.value);
            res = await runner.next();
        }

        // Debug: show actual results
        // The actual chronological order of events:
        // eslint-disable-next-line no-console
        console.log('runner.spec results:', results.map(r => ({...r, stamp: (r && (r as any).stamp) })));
        expect(results).toEqual([
            { type: 'value', value: 'A', sourceIndex: 0 },    // 20ms
            { type: 'value', value: 'B', sourceIndex: 1 },    // 40ms
            { type: 'complete', sourceIndex: 1 },             // ~40ms (Source 1 finishes)
            { type: 'value', value: 'C', sourceIndex: 0 },    // 60ms
            { type: 'complete', sourceIndex: 0 }              // ~60ms (Source 0 finishes)
        ]);
    });

    it("should support synchronous draining via __tryNext", () => {
        let pushed = false;
        const source0: any = {
            __tryNext: () => {
                if (!pushed) {
                    pushed = true;
                    return { done: false, value: "sync-val" };
                }
                return { done: true };
            },
            __onPush: null
        };

        const runner = createAsyncCoordinator([source0]);

        // Test synchronous behavior
        const res = runner.__tryNext?.();
        expect(res?.done).toBe(false);
        expect(res?.value).toEqual({ type: 'value', value: 'sync-val', sourceIndex: 0 });

        // Next sync pull should show completion for that source
        const completion = runner.__tryNext?.();
        expect(completion?.value).toEqual({ type: 'complete', sourceIndex: 0 });
    });

    it("should propagate errors from sources as error events", async () => {
        async function* errorSource() {
            await new Promise(r => setTimeout(r, 10));
            throw new Error("fail");
        }

        const runner = createAsyncCoordinator([errorSource()]);
        const res = await runner.next();

        expect(res.value).toEqual(jasmine.objectContaining({
            type: 'error',
            sourceIndex: 0
        }));
        expect((res.value as any).error.message).toBe("fail");
    });

    it("should cleanup all sources when runner.return() is called", async () => {
        let source0Returned = false;
        let source1Returned = false;

        const source0: any = {
            next: () => new Promise(() => { }), // Hangs
            return: () => { source0Returned = true; return Promise.resolve(DONE); }
        };
        const source1: any = {
            next: () => new Promise(() => { }), // Hangs
            return: () => { source1Returned = true; return Promise.resolve(DONE); }
        };

        const runner = createAsyncCoordinator([source0, source1]);
        await runner.return?.();

        expect(source0Returned).toBe(true);
        expect(source1Returned).toBe(true);
    });

    it("should preserve emission stamps from sources", async () => {
        const source0: any = {
            next: () => {
                const res = { done: false, value: "stamped" };
                setIteratorEmissionStamp(source0, 12345);
                return Promise.resolve(res);
            }
        };

        const runner = createAsyncCoordinator([source0]);
        await runner.next();

        expect(getIteratorEmissionStamp(runner)).toBe(12345);
    });
});