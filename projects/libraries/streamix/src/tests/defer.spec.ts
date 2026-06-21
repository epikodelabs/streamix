import { atom, defer, from, iterate, type Atom } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

function mockSource(values: any[], completed = false, error?: Error): any {
  const subject: Atom<any> = atom<any>();

  setTimeout(() => {
    if (error) {
      subject.fail(error);
      return;
    }

    values.forEach(value => subject.next(value));

    if (completed) {
      subject.dispose();
    }
  }, 0);

  return subject;
}

describe('defer', () => {
  it('should create a new stream each time it is subscribed to', async () => {
    const emissions = [1, 2, 3];
    const factory = jasmine.createSpy('factory').and.callFake(() => mockSource(emissions, true));

    const deferAtom = defer(factory);

    const collected: number[] = [];
    deferAtom.subscribe(v => { if (v !== undefined) collected.push(v); });
    await delay();

    expect(factory).toHaveBeenCalled();
    expect(collected.length).toBe(3);
    expect(collected).toEqual([1, 2, 3]);
  });

  it('should handle stream completion', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => mockSource([], true));

    const deferAtom = defer(factory);

    const collected: any[] = [];
    deferAtom.subscribe(v => { if (v !== undefined) collected.push(v); });
    await delay();

    expect(factory).toHaveBeenCalled();
    expect(collected).toEqual([]);
  });

  it('should handle stream errors', async () => {
    const error = new Error('Test Error');
    const factory = jasmine.createSpy('factory').and.callFake(() => mockSource([], false, error));

    const deferAtom = defer(factory);

    let caught: any;
    try {
      for await (const v of iterate(deferAtom)) {
        fail(`Should not emit, got ${v}`);
      }
    } catch (e) {
      caught = e;
    }

    expect(caught).toEqual(error);
  });

  it('supports promised factory results', async () => {
    const atom = defer(() => from(['defered', 'values']));
    const results: string[] = [];

    for await (const value of iterate(atom)) {
      if (value !== undefined) results.push(value);
    }

    expect(results).toEqual(['defered', 'values']);
  });

  it('supports factories that return promises resolving to streams', async () => {
    const factory = jasmine
      .createSpy('factory')
      .and.callFake(async () => from([10, 20]));

    const atom = defer(() => factory());
    const results: number[] = [];

    for await (const value of iterate(atom)) {
      if (value !== undefined) results.push(value);
    }

    expect(factory).toHaveBeenCalled();
    expect(results).toEqual([10, 20]);
  });

  it('throws when the factory promises reject', async () => {
    const err = new Error('factory failure');
    const atom = defer(() => Promise.reject(err));

    let caught: any;
    try {
      for await (const _ of iterate(atom)) {
        fail('should not emit');
      }
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(err);
  });

  it('emits plain values returned by the factory immediately', async () => {
    const atom = defer(() => 42);
    const results: number[] = [];

    for await (const value of iterate(atom)) {
      if (value !== undefined) results.push(value);
    }

    expect(results).toEqual([42]);
  });
});
