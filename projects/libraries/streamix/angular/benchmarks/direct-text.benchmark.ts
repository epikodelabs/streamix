import { atom } from '@epikodelabs/streamix';

import {
  bindText,
  rendererScheduler,
} from '../src/lib';

/**
 * Microbenchmark scaffold for the direct binding hot path.
 *
 * This intentionally does not publish comparative numbers. Run equivalent
 * workloads against raw DOM, Angular Signals, and Million.js in the same
 * browser/build before making performance claims.
 */
export function benchmarkDirectText(iterations = 100_000): number {
  const source = atom(0);
  const text = document.createTextNode('');
  const binding = bindText(source, text);

  const started = performance.now();

  for (let index = 0; index < iterations; index += 1) {
    source.set(index);
  }

  rendererScheduler.flushNow();

  const elapsed = performance.now() - started;

  binding.destroy();

  if (text.textContent !== String(iterations - 1)) {
    throw new Error('Benchmark produced an invalid final value.');
  }

  return elapsed;
}
