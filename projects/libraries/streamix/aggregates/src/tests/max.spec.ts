import { atom, pipe, type Writable } from '@epikodelabs/streamix';
import { max } from '@epikodelabs/streamix/aggregates';
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
describe('max', () => {
    let subject: Writable<number>;
    let source: Writable<number>;
    beforeEach(() => {
        subject = atom<number>();
        source = subject;
    });
    it('should emit the largest value', async () => {
        const maxResult = pipe(source, max());
        const results: number[] = [];
        void (async () => {
            for await (const value of maxResult) {
                results.push(value);
            }
        })();
        subject.next(1);
        subject.next(3); // Largest value
        subject.next(2);
        subject.dispose();
        await settle();
        expect(results).toEqual([3]);
    });
    it('should propagate errors from the source stream', async () => {
        const maxResult = pipe(source, max());
        let error: any = null;
        void (async () => {
            try {
                for await (const _ of maxResult) {
                    void _;
                }
            }
            catch (err) {
                error = err;
            }
        })();
        subject.fail(new Error('Test Error'));
        await settle();
        expect(error).toEqual(new Error('Test Error'));
    });
});
