import { compose, filter, from, iterate, map, pipe, take } from '@epikodelabs/streamix';

describe('compose', () => {
    it('composes multiple operators into one operator', async () => {
        const source = from([1, 2, 3, 4, 5]);
        const doubleThenFilter = compose(
            map((value: number) => value * 2),
            filter((value: number) => value > 4)
        );
        const result = pipe(source, doubleThenFilter);
        const results: number[] = [];
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
        const identity = compose();
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
});
