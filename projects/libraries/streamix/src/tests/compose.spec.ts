import { compose, filter, from, iterate, map, pipe, take } from '@epikodelabs/streamix';

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;
function assertType<_T extends true>(): void {}

describe('compose', () => {
    it('composes multiple operators into one operator', async () => {
        const source = from([1, 2, 3, 4, 5]);
        const doubleThenFilter = compose(
            map((value: number) => value * 2),
            filter(value => value > 4)
        );
        const result = pipe(source, doubleThenFilter);
        const results = [];
        for await (const value of iterate(result)) {
            results.push(value);
        }
        expect(results).toEqual([6, 8, 10]);
    });

    it('can be reused across multiple pipelines', async () => {
        const pipeline = compose(
            map((value: number) => value + 1),
            filter((value: number) => value > 2)
        );

        const first = pipe(from([1, 2, 3]), pipeline);
        const second = pipe(from([0, 5, 6]), pipeline);

        const firstResults: number[] = [];
        const secondResults: number[] = [];

        for await (const value of iterate(first)) {
            firstResults.push(value);
        }
        for await (const value of iterate(second)) {
            secondResults.push(value);
        }

        expect(firstResults).toEqual([3, 4]);
        expect(secondResults).toEqual([6, 7]);
    });

    it('returns an identity operator when called with no operators', async () => {
        const source = from([1, 2, 3]);
        const identity = compose<number>();
        const result = pipe(source, identity);
        const results: number[] = [];
        for await (const value of iterate(result)) {
            results.push(value);
        }
        expect(results).toEqual([1, 2, 3]);
    });

    it('works with more than two operators', async () => {
        const source = from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        const pipeline = compose(
            map((value: number) => value * 2),
            filter((value: number) => value > 6),
            take(3)
        );
        const result = pipe(source, pipeline);
        const results: number[] = [];
        for await (const value of iterate(result)) {
            results.push(value);
        }
        expect(results).toEqual([8, 10, 12]);
    });

    it('infers the composed operator type across type changes', async () => {
        const source = from([1, 2, 3]);
        const toStringThenFilter = compose(
            map((value: number) => String(value)),
            filter((value: string) => value !== '2')
        );
        type _Inferred = AssertEqual<typeof toStringThenFilter, import('@epikodelabs/streamix').Operator<number, string>>;
        assertType<_Inferred>();
        const result = pipe(source, toStringThenFilter);
        const results: string[] = [];
        for await (const value of iterate(result)) {
            results.push(value);
        }
        expect(results).toEqual(['1', '3']);
    });
});
