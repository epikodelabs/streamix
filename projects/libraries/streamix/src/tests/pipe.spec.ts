import { atom, filter, from, iterate, map, pipe, type Atom } from '@epikodelabs/streamix';

async function collect<T>(source: AsyncIterable<T>, count: number): Promise<T[]> {
    const results: T[] = [];
    for await (const value of source) {
        results.push(value);
        if (results.length >= count) break;
    }
    return results;
}

describe('pipe', () => {
    it('can pass the result of one pipe as the input of another', async () => {
        const source = from([1, 2, 3, 4, 5]);
        const doubled = pipe(source, map((value) => value * 2));
        const evens = pipe(doubled, filter((value) => value % 4 === 0));
        const results: number[] = [];
        for await (const value of iterate(evens)) {
            results.push(value);
        }
        expect(results).toEqual([4, 8]);
    });
    it('can chain pipe calls via an intermediate variable', async () => {
        const source = from([1, 2, 3, 4]);
        const incremented = pipe(source, map((value) => value + 1));
        const result = pipe(incremented, filter((value) => value > 2));
        const results: number[] = [];
        for await (const value of iterate(result)) {
            results.push(value);
        }
        expect(results).toEqual([3, 4, 5]);
    });
    it('can combine atoms of different types into a tuple', async () => {
        type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;
        const name = atom('Alice');
        const age = atom(30);
        const active = atom(true);
        const combined = pipe([name, age, active]);
        type CombinedValue = typeof combined extends Atom<infer T> ? T : never;
        type _Inferred = AssertEqual<CombinedValue, [string, number, boolean]>;

        const pending = collect(combined, 3);

        name.next('Bob');
        age.next(31);
        active.next(false);

        const results = await pending;
        expect(results).toEqual([
            ['Bob', 30, true],
            ['Bob', 31, true],
            ['Bob', 31, false],
        ]);
    });
});
