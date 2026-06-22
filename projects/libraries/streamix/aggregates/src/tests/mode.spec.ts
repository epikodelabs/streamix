import { atom, pipe } from '@epikodelabs/streamix';
import { mode } from '@epikodelabs/streamix/aggregates';
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
describe('mode', () => {
    let subject: ReturnType<typeof atom<number>>;
    let source: ReturnType<typeof atom<number>>;
    beforeEach(() => {
        subject = atom<number>();
        source = subject;
    });
    it('should emit the most frequently occurring value', async () => {
        const modeResult = pipe(source, mode());
        const results: number[][] = [];
        void (async () => {
            for await (const value of modeResult) {
                results.push(value);
            }
        })();
        subject.next(1);
        subject.next(2);
        subject.next(2);
        subject.next(3);
        subject.dispose();
        await settle();
        expect(results).toEqual([[2]]);
    });
    it('should emit all values that share the top frequency', async () => {
        const modeResult = pipe(source, mode());
        const results: number[][] = [];
        void (async () => {
            for await (const value of modeResult) {
                results.push(value);
            }
        })();
        subject.next(1);
        subject.next(2);
        subject.next(1);
        subject.next(2);
        subject.dispose();
        await settle();
        expect(results).toEqual([[1, 2]]);
    });
    it('should be able to key values before counting', async () => {
        const items = atom<{
            group: string;
            value: string;
        }>();
        const modeResult = pipe(items, mode((item) => item.group));
        const results: {
            group: string;
            value: string;
        }[][] = [];
        void (async () => {
            for await (const value of modeResult) {
                results.push(value);
            }
        })();
        items.next({ group: 'alpha', value: 'a' });
        items.next({ group: 'beta', value: 'b' });
        items.next({ group: 'alpha', value: 'a2' });
        items.next({ group: 'beta', value: 'b2' });
        items.dispose();
        await settle();
        expect(results).toEqual([
            [
                { group: 'alpha', value: 'a' },
                { group: 'beta', value: 'b' },
            ],
        ]);
    });
    it('should not emit when the stream is empty', async () => {
        const modeResult = pipe(source, mode());
        const results: number[][] = [];
        void (async () => {
            for await (const value of modeResult) {
                results.push(value);
            }
        })();
        subject.dispose();
        await settle();
        expect(results).toEqual([]);
    });
});
