import type { Readable } from '@epikodelabs/streamix';
import { on } from '@epikodelabs/streamix/dom';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

const media = on('mediaQuery', '(min-width: 600px)');

// DOM factories return readable sources, never writable atoms.
type _MediaQueryInference = Expect<Equal<typeof media, Readable<boolean>>>;

const inferenceChecks: [_MediaQueryInference] = [true];

function capabilityContract(): void {
  // @ts-expect-error DOM factories expose no write surface
  media.set(true);
  // @ts-expect-error DOM factories expose no write surface
  media.next(true);
}

describe('DOM factory capability types', () => {
  it('infers read-only DOM sources', () => {
    expect(inferenceChecks).toEqual([true]);
    expect(typeof capabilityContract).toBe('function');
    expect(typeof media.subscribe).toBe('function');
    expect(typeof media.onError).toBe('function');
  });

  afterAll(() => media.dispose());
});
