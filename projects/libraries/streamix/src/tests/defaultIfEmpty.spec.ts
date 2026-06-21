import { concatMap, defaultIfEmpty, iterate, atom as makeAtom, pipe, type Writable } from '@epikodelabs/streamix';

describe('defaultIfEmpty', () => {
  it('should emit the default value if no values are emitted', async () => {
    const subject: Writable<string> = makeAtom<string>();
    const defaultValue = 'Default Value';
    const atom = pipe(subject, defaultIfEmpty(defaultValue));
    const results: string[] = [];

    const consumptionPromise = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.dispose();

    await consumptionPromise;

    expect(results).toEqual([defaultValue]);
  });

  it('should not emit the default value if values are emitted', async () => {
    const subject: Writable<string> = makeAtom<string>();
    const defaultValue = 'Default Value';
    const atom = pipe(subject, defaultIfEmpty(defaultValue));
    const results: string[] = [];

    const consumptionPromise = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.next('Value 1');
    subject.next('Value 2');
    subject.dispose();

    await consumptionPromise;

    expect(results).toEqual(['Value 1', 'Value 2']);
  });

  it('should emit default value when an upstream operator yields no values', async () => {
    const subject: Writable<string> = makeAtom<string>();
    const defaultValue = 'Default Value';
    const atom = pipe(
      subject,
      concatMap(() => []),
      defaultIfEmpty(defaultValue)
    );
    const results: string[] = [];

    const consumptionPromise = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.next('Value 1');
    subject.dispose();

    await consumptionPromise;

    expect(results).toEqual([defaultValue]);
  });

  it('should not emit default value if values are emitted before', async () => {
    const subject: Writable<string> = makeAtom<string>();
    const defaultValue = 'Default Value';
    const atom = pipe(
      subject,
      concatMap(() => 'Value 3'),
      defaultIfEmpty(defaultValue)
    );
    const results: string[] = [];

    const consumptionPromise = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.next('Value 1');
    subject.next('Value 2');
    subject.dispose();

    await consumptionPromise;

    expect(results).toEqual(['Value 3', 'Value 3']);
  });
});
