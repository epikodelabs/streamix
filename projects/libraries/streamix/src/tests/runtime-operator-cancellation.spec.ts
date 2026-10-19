import { trackOperatorExecution } from '../lib/runtime/operator-execution';
import { internalRuntime } from '../lib/runtime/runtime';

describe('runtime operator cancellation accounting', () => {
  it('releases active execution immediately when return cleanup stays pending', async () => {
    let resolveReturn!: (result: IteratorResult<number>) => void;
    const iterator: AsyncIterator<number> = {
      next: async () => ({ done: false, value: 1 }),
      return: () => new Promise(resolve => { resolveReturn = resolve; }),
    };
    const tracked = trackOperatorExecution(iterator);
    const before = internalRuntime.diagnostics.executions.snapshot();
    expect((await tracked.next()).value).toBe(1);
    const cleanup = tracked.return!();
    const during = internalRuntime.diagnostics.executions.snapshot();
    expect(during.active).toBe(before.active);
    expect(during.cancelled).toBe(before.cancelled + 1);
    resolveReturn({ done: true, value: undefined });
    await cleanup;
    expect(internalRuntime.diagnostics.executions.snapshot().cancelled).toBe(before.cancelled + 1);
  });
});
