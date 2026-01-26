import { createScheduler } from "@epikodelabs/streamix";

describe("scheduler", () => {
    let scheduler: ReturnType<typeof createScheduler>;

    beforeEach(() => {
        scheduler = createScheduler();
    });

    it("should execute queued tasks", async () => {
        let executed = false;
        await scheduler.enqueue(() => {
            executed = true;
        });
        expect(executed).toBe(true);
    });

    it("should return values from queued tasks", async () => {
        const result = await scheduler.enqueue(() => 42);
        expect(result).toBe(42);
    });

    it("should handle async tasks", async () => {
        const result = await scheduler.enqueue(async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return "async";
        });
        expect(result).toBe("async");
    });

    it("should execute tasks sequentially", async () => {
        const sequence: number[] = [];
        const task1 = scheduler.enqueue(async () => {
            await new Promise(resolve => setTimeout(resolve, 20)); // Slow task
            sequence.push(1);
        });
        const task2 = scheduler.enqueue(() => {
            sequence.push(2); // Fast task
        });

        await Promise.all([task1, task2]);
        expect(sequence).toEqual([1, 2]); // Must be 1 then 2, even if 1 is slower
    });

    it("should propagate errors from tasks", async () => {
        await expectAsync(scheduler.enqueue(() => {
            throw new Error("fail");
        })).toBeRejectedWithError("fail");
    });

    it("should continue processing after an error", async () => {
        try {
            await scheduler.enqueue(() => { throw new Error("fail"); });
        } catch { }

        const result = await scheduler.enqueue(() => "success");
        expect(result).toBe("success");
    });

    it("flush() should resolve when all pending tasks are done", async () => {
        let count = 0;
        scheduler.enqueue(async () => {
            await new Promise(r => setTimeout(r, 10));
            count++;
        });
        scheduler.enqueue(async () => {
            await new Promise(r => setTimeout(r, 10));
            count++;
        });

        await scheduler.flush();
        expect(count).toBe(2);
    });

    it("delay() should wait for specified time", async () => {
        const start = Date.now();
        await scheduler.delay(50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some leniency
    });
});
