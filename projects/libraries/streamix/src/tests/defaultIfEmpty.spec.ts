import { concatMap, atom, fromAtom, defaultIfEmpty, EMPTY, of, type Atom } from '@epikodelabs/streamix';

describe('defaultIfEmpty', () => {
  it('should emit the default value if no values are emitted', (done) => {
    const source$: Atom<any> = atom();
    const stream = fromAtom(source$);
    const defaultValue = 'Default Value';
    const processedStream = stream.pipe(defaultIfEmpty(defaultValue));
    const emittedValues: any[] = [];

    processedStream.subscribe({
      next: (value) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([defaultValue]);
        done();
      }
    });

    source$.dispose();
  });

  it('should not emit the default value if values are emitted', (done) => {
    const source$: Atom<string> = atom<string>();
    const stream = fromAtom(source$);
    const defaultValue = 'Default Value';
    const processedStream = stream.pipe(defaultIfEmpty(defaultValue));
    const emittedValues: any[] = [];

    processedStream.subscribe({
      next: (value) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual(['Value 1', 'Value 2']);
        done();
      }
    });

    source$.set('Value 1');
    source$.set('Value 2');
    source$.dispose();
  });

  it('should emit default value when one operator returns EMPTY', (done) => {
    const source$: Atom<string> = atom<string>();
    const stream = fromAtom(source$);
    const defaultValue = 'Default Value';
    const processedStream = stream.pipe(
      concatMap(() => EMPTY), // This operator simulates an empty stream
      defaultIfEmpty(defaultValue) // This operator provides a default value if the stream is empty
    );

    const emittedValues: any[] = [];

    processedStream.subscribe({
      next: (value) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([defaultValue]);
        done();
      }
    });

    source$.set('Value 1');

    source$.dispose();
  });

  it('should not emit default value if values are emitted before', (done) => {
    const source$: Atom<string> = atom<string>();
    const stream = fromAtom(source$);
    const defaultValue = 'Default Value';
    const processedStream = stream.pipe(
      concatMap(() => of('Value 3')), // This operator simulates a new stream
      defaultIfEmpty(defaultValue) // This operator provides a default value if the stream is empty
    );

    const emittedValues: any[] = [];

    processedStream.subscribe({
      next: (value) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual(['Value 3', 'Value 3']);
        done();
      }
    });

    source$.set('Value 1');
    source$.set('Value 2');

    source$.dispose();
  });
});
