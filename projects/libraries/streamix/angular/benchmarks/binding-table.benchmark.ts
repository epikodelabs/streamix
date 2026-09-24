import { atom } from '@epikodelabs/streamix';

import {
  createBindingTable,
  rendererScheduler,
  ɵsxText,
} from '../src/lib';

/**
 * Compiler-path microbenchmark scaffold.
 *
 * No comparative performance claim should be made from this function alone.
 */
export function benchmarkBindingTable(
  bindingCount = 1_000,
  updates = 100_000,
): number {
  const sources = Array.from({ length: bindingCount }, () => atom(0));
  const nodes = Array.from(
    { length: bindingCount },
    () => document.createTextNode(''),
  );

  const table = createBindingTable(bindingCount);

  for (let slot = 0; slot < bindingCount; slot += 1) {
    ɵsxText(table, slot, nodes[slot], sources[slot]);
  }

  const started = performance.now();

  for (let update = 0; update < updates; update += 1) {
    const slot = update % bindingCount;
    sources[slot].set(update);
  }

  rendererScheduler.flushNow();

  const elapsed = performance.now() - started;
  table.destroy();

  return elapsed;
}
