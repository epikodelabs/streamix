import {
  atom,
} from '@epikodelabs/streamix';

import {
  rendererScheduler,
  ɵcreateSxCompiledBlock,
  type SxCompiledBlockInstance,
  ɵcreateSxFragmentRange,
  ɵcreateSxKeyedBlock,
} from '../src/lib';

import {
  runBenchmark,
  type BenchmarkCase,
} from './benchmark-harness';

interface Row {
  readonly id: number;
  readonly label: string;
}

function rows(count: number): Row[] {
  return Array.from(
    { length: count },
    (_value, index) => ({
      id: index,
      label: `row-${index}`,
    }),
  );
}

function rotate<T>(
  values: readonly T[],
): T[] {
  if (values.length < 2) return [...values];

  return [
    values[values.length - 1],
    ...values.slice(0, -1),
  ];
}

export function keyedReorderCase(
  rowCount = 1_000,
  depth = 0,
): BenchmarkCase {
  return {
    name: `sx/keyed-reorder-${rowCount}${depth > 0 ? `-depth-${depth}` : ''}`,
    setup() {
      const host = document.createElement('div');
      const anchor = document.createComment('sx');
      host.appendChild(anchor);

      let current = rows(rowCount);
      const source = atom<Iterable<Row> | undefined>(
        current,
      );

      const block = ɵcreateSxKeyedBlock(
        anchor,
        source,
        {
          create(row) {
            const element =
              document.createElement('div');
            // Deep rows expose per-move subtree work; shallow rows measure the
            // reconciliation path itself.
            let deepest = element;
            for (let level = 0; level < depth; level += 1) {
              const child = document.createElement('div');
              deepest.appendChild(child);
              deepest = child;
            }
            const text =
              document.createTextNode('');

            deepest.appendChild(text);

            const range =
              ɵcreateSxFragmentRange([element]);

            return ɵcreateSxCompiledBlock(
              range.first,
              range.last,
              context => {
                text.data = context.label;
              },
              {
                label: row.label,
              },
            );
          },
          update(instance, row) {
            (
              instance as SxCompiledBlockInstance<{ label: string }>
            ).update({
              label: row.label,
            });
          },
        },
        (_index, row) => row.id,
      );

      return {
        run(iterations) {
          for (
            let iteration = 0;
            iteration < iterations;
            iteration += 1
          ) {
            current = rotate(current);
            source.set(current);
            rendererScheduler.flushNow();
          }
        },
        destroy() {
          block.destroy();
        },
      };
    },
  };
}

export function benchmarkKeyedReorder(
  rowCount = 1_000,
  iterations = 1_000,
) {
  return runBenchmark(
    keyedReorderCase(rowCount),
    { iterations },
  );
}
