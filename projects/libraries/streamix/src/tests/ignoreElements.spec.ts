import { atom, fromAtom, ignoreElements } from "@epikodelabs/streamix";

describe("ignoreElements", () => {
  it("should ignore all emitted values and only emit complete", (done) => {
    const source$ = atom<number>();
    const sourceStream = fromAtom(source$);
    const emittedValues: number[] = [];
    const ignoredStream = sourceStream.pipe(ignoreElements());

    ignoredStream.subscribe({
      next: (value) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([]);
        done();
      },
      error: (err) => done.fail(err.message),
    });

    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.dispose();
  });

  it("should pass error notifications through", (done) => {
    const source$ = atom<number>();
    const sourceStream = fromAtom(source$);
    const emittedValues: number[] = [];
    const ignoredStream = sourceStream.pipe(ignoreElements());

    ignoredStream.subscribe({
      next: (value) => emittedValues.push(value),
      complete: () => {},
      error: (err) => {
        expect(err.message).toBe("Test error");
        expect(emittedValues).toEqual([]);
        done();
      },
    });

    source$.set(1);
    source$.set(2);
    source$.setError(new Error("Test error"));
  });

  it("should complete after source stream completes", (done) => {
    const source$ = atom<number>();
    const sourceStream = fromAtom(source$);
    const emittedValues: number[] = [];
    const ignoredStream = sourceStream.pipe(ignoreElements());

    ignoredStream.subscribe({
      next: (value) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([]);
        done();
      },
      error: (err) => done.fail(err.message),
    });

    source$.set(10);
    source$.set(20);
    source$.dispose();
  });

  it("should not emit any value but should handle complete", (done) => {
    const source$ = atom<string>();
    const sourceStream = fromAtom(source$);
    const emittedValues: string[] = [];
    const ignoredStream = sourceStream.pipe(ignoreElements());

    ignoredStream.subscribe({
      next: (value) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([]);
        done();
      },
      error: (err) => done.fail(err.message),
    });

    source$.set("value1");
    source$.set("value2");
    source$.dispose();
  });

  it("should handle error in source stream", (done) => {
    const source$ = atom<string>();
    const sourceStream = fromAtom(source$);
    const emittedValues: string[] = [];
    const ignoredStream = sourceStream.pipe(ignoreElements());

    ignoredStream.subscribe({
      next: (value) => emittedValues.push(value),
      complete: () => {},
      error: (err) => {
        expect(err.message).toBe("Some error");
        expect(emittedValues).toEqual([]);
        done();
      },
    });

    source$.set("value1");
    source$.set("value2");
    source$.setError(new Error("Some error"));
  });
});
