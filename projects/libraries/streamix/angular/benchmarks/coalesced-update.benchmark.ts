import {
  atom,
} from '@epikodelabs/streamix';

import {
  createBindingTable,
  rendererScheduler,
  ɵsxText,
} from '../src/lib';

import {
  runBenchmark,
  type BenchmarkCase,
} from './benchmark-harness';

const sxCoalesced: BenchmarkCase = {
  name: 'sx/coalesced-100-writes',
  setup() {
    const source = atom(0);
    const text = document.createTextNode('');
    const table = createBindingTable(1);

    ɵsxText(table, 0, text, source);

    return {
      run(iterations) {
        for (let batch = 0; batch < iterations; batch += 1) {
          for (let write = 0; write < 100; write += 1) {
            source.set(write);
          }

          rendererScheduler.flushNow();
        }
      },
      destroy() {
        table.destroy();
      },
    };
  },
};

export function benchmarkCoalescing(
  batches = 10_000,
) {
  return runBenchmark(
    sxCoalesced,
    {
      iterations: batches,
    },
  );
}
