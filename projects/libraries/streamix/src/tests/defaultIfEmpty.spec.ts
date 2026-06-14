import { concatMap, createSubject, defaultIfEmpty, iterate, pipe, type Subject } from '@epikodelabs/streamix';

describe('defaultIfEmpty', () => {
  it('should emit the default value if no values are emitted', async () => {
    const subject = createSubject<string>();
    const defaultValue = 'Default Value';
    const atom = pipe(subject, defaultIfEmpty(defaultValue));
    const results: string[] = [];

    const consumptionPromise = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    subject.complete();

    await consumptionPromise;

    expect(results).toEqual([defaultValue]);
  });

  it('should not emit the default value if values are emitted', async () => {
    const subject = createSubject<string>();
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
    subject.complete();

    await consumptionPromise;

    expect(results).toEqual(['Value 1', 'Value 2']);
  });

  it('should emit default value when an upstream operator yields no values', async () => {
    const subject = createSubject<string>();
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
    subject.complete();

    await consumptionPromise;

    expect(results).toEqual([defaultValue]);
  });

  it('should not emit default value if values are emitted before', async () => {
    const subject = createSubject<string>();
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
    subject.complete();

    await consumptionPromise;

    expect(results).toEqual(['Value 3', 'Value 3']);
  });
});
