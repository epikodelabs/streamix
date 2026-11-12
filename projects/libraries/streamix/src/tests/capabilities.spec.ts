import {
  asReadable,
  atom,
  fromIterator,
  derived,
  flow,
  lens,
  pipe,
  scope,
  type Atom,
  type Lens,
  type Readable,
  type Writable,
} from '@epikodelabs/streamix';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

const writable = atom(1);
const derivedValue = derived(() => writable.value * 2);
const flowValue = flow(async function* () { yield 1; });
const iterated = fromIterator((async function* () { yield 1; })());
const pipedSource = atom(1);
const piped = pipe(pipedSource);
const readView = asReadable(writable);

const lensSource = atom({ count: 1 });
const writableLens = lens(lensSource, 'count');
const nestedSource = atom({ outer: { value: 1 } });
const deepLens = lens(lens(nestedSource, 'outer'), 'value');
const readOnlySource = atom({ label: 'x' });
const readOnlyLens = lens(asReadable(readOnlySource), 'label');

const scoped = scope({ count: 1 });
const scopeCount = scoped.get('count');
const scopeLoading = scoped.get('loading');

// atom() infers the writable atom surface: Readable + Writable.
type _WritableInference = Expect<Equal<typeof writable, Writable<number>>>;
type _AtomInference = Expect<Equal<Atom<number>, Writable<number>>>;
// derived(), flow(), fromIterator(), and pipe() infer read-only surfaces.
type _DerivedInference = Expect<Equal<typeof derivedValue, Readable<number>>>;
type _FlowInference = Expect<Equal<typeof flowValue, Readable<number>>>;
type _IteratorInference = Expect<Equal<typeof iterated, Readable<number>>>;
type _PipeInference = Expect<Equal<typeof piped, Readable<number>>>;
// asReadable() stays readable.
type _AsReadableInference = Expect<Equal<typeof readView, Readable<number>>>;
// Writable lenses compose; read-only sources produce read-only lenses.
type _WritableLensInference = Expect<Equal<typeof writableLens, Lens<number>>>;
type _ComposedLensInference = Expect<Equal<typeof deepLens, Lens<number>>>;
type _ReadOnlyLensInference = Expect<Equal<typeof readOnlyLens, Readable<string>>>;
// Scope members keep their capabilities; reserved atoms are readable only.
type _ScopeMemberInference = Expect<Equal<typeof scopeCount, Writable<number>>>;
type _ScopeReservedInference = Expect<Equal<typeof scopeLoading, Readable<boolean>>>;

// Referencing the aliases keeps tsc checking them under noUnusedLocals.
const inferenceChecks: [
  _WritableInference,
  _AtomInference,
  _DerivedInference,
  _FlowInference,
  _IteratorInference,
  _PipeInference,
  _AsReadableInference,
  _WritableLensInference,
  _ComposedLensInference,
  _ReadOnlyLensInference,
  _ScopeMemberInference,
  _ScopeReservedInference,
] = [true, true, true, true, true, true, true, true, true, true, true, true];

function capabilityContract(): void {
  // Writable atoms support reads and writes.
  const readable: Readable<number> = writable;
  const writableAgain: Writable<number> = writable;
  writable.next(2);
  writable.set(3);
  writableLens.set(2);
  writableLens.next(3);
  deepLens.set(2);
  scopeCount.set(2);
  void readable;
  void writableAgain;

  // Read-only surfaces reject writes at compile time.
  // @ts-expect-error derived values expose no write surface
  derivedValue.next(2);
  // @ts-expect-error derived values expose no write surface
  derivedValue.set(2);
  // @ts-expect-error flow values expose no write surface
  flowValue.next(2);
  // @ts-expect-error flow values expose no write surface
  flowValue.set(2);
  // @ts-expect-error iterator-backed values expose no write surface
  iterated.set(2);
  // @ts-expect-error piped values expose no write surface
  piped.set(2);
  // @ts-expect-error asReadable() exposes no write surface
  readView.set(2);
  // @ts-expect-error read-only sources produce read-only lenses
  readOnlyLens.set('y');
  // @ts-expect-error read-only sources produce read-only lenses
  readOnlyLens.next('y');
  // @ts-expect-error scope reserved atoms are read-only
  scopeLoading.set(true);
}

describe('public capability types', () => {
  it('infers writable atoms and read-only derived, flow, pipeline, and lens values', () => {
    // Keep the compile-time contract referenced, then verify the same shape
    // at runtime: writes exist only where the type says they do.
    expect(inferenceChecks.every(value => value === true)).toBeTrue();
    expect(typeof capabilityContract).toBe('function');

    expect(typeof writable.next).toBe('function');
    expect(typeof writable.set).toBe('function');
    expect(typeof writableLens.set).toBe('function');
    expect(typeof writableLens.next).toBe('function');
    expect(typeof deepLens.set).toBe('function');
    expect(typeof scopeCount.set).toBe('function');

    for (const value of [derivedValue, flowValue, iterated, piped, readView, readOnlyLens]) {
      expect(typeof (value as any).next).toBe('undefined');
      expect(typeof (value as any).set).toBe('undefined');
    }

    // asReadable() keeps observation APIs and forwards disposal to the source.
    expect(typeof readView.subscribe).toBe('function');
    expect(typeof readView.dispose).toBe('function');

    expect(scopeCount.value).toBe(1);
  });

  afterAll(() => {
    writable.dispose();
    derivedValue.dispose();
    flowValue.dispose();
    iterated.dispose();
    piped.dispose();
    pipedSource.dispose();
    writableLens.dispose();
    lensSource.dispose();
    deepLens.dispose();
    nestedSource.dispose();
    readOnlyLens.dispose();
    readOnlySource.dispose();
    scoped.dispose();
  });
});
