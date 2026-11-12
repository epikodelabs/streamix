import { atom, derived, flow, type Atom, type Readable, type Writable } from '@epikodelabs/streamix';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

const writable = atom(1);
const derivedValue = derived(() => writable.value * 2);
const flowValue = flow(async function* () { yield 1; });

// atom() infers the writable atom surface: Readable + Writable.
type _WritableInference = Expect<Equal<typeof writable, Writable<number>>>;
type _AtomInference = Expect<Equal<Atom<number>, Writable<number>>>;
// derived() and flow() infer the read-only surface.
type _DerivedInference = Expect<Equal<typeof derivedValue, Readable<number>>>;
type _FlowInference = Expect<Equal<typeof flowValue, Readable<number>>>;

// Referencing the aliases keeps tsc checking them under noUnusedLocals.
const inferenceChecks: [_WritableInference, _AtomInference, _DerivedInference, _FlowInference] = [true, true, true, true];

function capabilityContract(): void {
  // Writable atoms support reads and writes.
  const readable: Readable<number> = writable;
  const writableAgain: Writable<number> = writable;
  writable.next(2);
  writable.set(3);
  void readable;
  void writableAgain;

  // Derived and flow values are readable only.
  // @ts-expect-error derived values expose no write surface
  derivedValue.next(2);
  // @ts-expect-error derived values expose no write surface
  derivedValue.set(2);
  // @ts-expect-error flow values expose no write surface
  flowValue.next(2);
  // @ts-expect-error flow values expose no write surface
  flowValue.set(2);
}

describe('public capability types', () => {
  it('infers writable atoms and read-only derived and flow values', () => {
    // Keep the compile-time contract referenced, then verify the same shape
    // at runtime: writes exist only on atom().
    expect(inferenceChecks).toEqual([true, true, true, true]);
    expect(typeof capabilityContract).toBe('function');
    expect(typeof writable.next).toBe('function');
    expect(typeof writable.set).toBe('function');
    expect(typeof (derivedValue as any).next).toBe('undefined');
    expect(typeof (derivedValue as any).set).toBe('undefined');
    expect(typeof (flowValue as any).next).toBe('undefined');
    expect(typeof (flowValue as any).set).toBe('undefined');
    writable.dispose();
    derivedValue.dispose();
    flowValue.dispose();
  });
});
