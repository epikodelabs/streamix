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

const rawDom: BenchmarkCase = {
  name: 'raw-dom/text.data',
  setup() {
    const text = document.createTextNode('');

    return {
      run(iterations) {
        for (let index = 0; index < iterations; index += 1) {
          text.data = String(index);
        }
      },
      destroy() {},
    };
  },
};

const sxCompiledText: BenchmarkCase = {
  name: 'sx/compiled-text',
  setup() {
    const source = atom(0);
    const text = document.createTextNode('');
    const table = createBindingTable(1);

    ɵsxText(table, 0, text, source);

    return {
      run(iterations) {
        for (let index = 0; index < iterations; index += 1) {
          source.set(index);
          rendererScheduler.flushNow();
        }
      },
      destroy() {
        table.destroy();
      },
    };
  },
};

export function benchmarkScalarUpdates(
  iterations = 100_000,
) {
  return [
    runBenchmark(rawDom, { iterations }),
    runBenchmark(sxCompiledText, { iterations }),
  ];
}
