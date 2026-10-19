import { internalRuntime } from '../lib/runtime/runtime';
import { RuntimeExecutions } from '../lib/runtime/diagnostics';
import { flow } from '../lib/atoms/atom';

describe('runtime flow execution accounting', () => {
  it('ignores stale execution generations', () => {
    const executions = new RuntimeExecutions();
    const node = {};
    const first = executions.start(node);
    const second = executions.start(node);
    executions.next(node, first);
    executions.finish(node, first, 'cancel');
    expect(executions.snapshot().active).toBe(1);
    executions.next(node, second);
    executions.finish(node, second, 'complete');
    expect(executions.snapshot().emitted).toBe(1);
    expect(executions.snapshot().completed).toBe(1);
  });

  it('shares a producer between subscribers and accounts for emissions', async () => {
    let starts = 0;
    let release!: (value: IteratorResult<number>) => void;
    const source = flow<number>(async function* () {
      starts++;
      yield 1;
      yield await new Promise<number>(resolve => {
        release = value => resolve(value.value!);
      });
    });
    const baseline = internalRuntime.diagnostics.executions.snapshot();
    const first: number[] = [];
    const second: number[] = [];
    const sub1 = source.subscribe(value => { first.push(value); });
    const sub2 = source.subscribe(value => { second.push(value); });
    for (let i = 0; i < 10 && first.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(starts).toBe(1);
    expect(first).toEqual([1]);
    expect(second).toEqual([1]);
    expect(internalRuntime.diagnostics.executions.snapshot().started - baseline.started).toBe(1);
    release({ value: 2, done: false });
    await sub1();
    await sub2();
    source.dispose();
    expect(internalRuntime.diagnostics.executions.snapshot().active).toBeLessThanOrEqual(baseline.active);
  });
});
