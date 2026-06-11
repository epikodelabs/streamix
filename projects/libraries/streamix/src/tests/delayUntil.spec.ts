import { atom, fromAtom, delayUntil, type Atom } from "@epikodelabs/streamix"; // Import your delayUntil operator


describe("delayUntil", () => {
  it("should delay emissions until the condition stream emits a value", async () => {
    const source$: Atom<number> = atom<number>();
    const sourceStream = fromAtom(source$);
    const condition$: Atom<any> = atom<any>();
    const conditionStream = fromAtom(condition$);

    const emittedValues: number[] = [];
    const delayedStream = sourceStream.pipe(delayUntil(conditionStream));

    await new Promise<void>((resolve, reject) => {
      delayedStream.subscribe({
        next: (value) => emittedValues.push(value),
        complete: () => {
          try {
            expect(emittedValues).toEqual([1, 2, 3, 4]); // Expectation is now waited for
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        error: (err) => reject(new Error(`Stream failed: ${err}`)),
      });

      source$.set(1); // Buffered
      condition$.set("start"); // Emission starts
      source$.set(2); // Emitted
      source$.set(3); // Emitted
      source$.set(4); // Emitted

      // FIX: Must complete the source stream for the delayed stream to complete
      source$.dispose();
      condition$.dispose();
    });
  });


  it("should not emit any values if condition stream does not emit", async () => {
    const source$: Atom<number> = atom<number>();
    const sourceStream = fromAtom(source$);
    const condition$: Atom<any> = atom<any>();
    const conditionStream = fromAtom(condition$);

    const emittedValues: number[] = [];
    const delayedStream = sourceStream.pipe(delayUntil(conditionStream));

    await new Promise<void>((resolve, reject) => {
      delayedStream.subscribe({
        next: (value) => emittedValues.push(value),
        complete: () => {
          try {
            expect(emittedValues).toEqual([]); // Expectation is now waited for
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        error: (err) => reject(new Error(`Stream failed: ${err}`)),
      });

      source$.set(1);
      source$.set(2);
      source$.set(3);

      // FIX: Must complete the source stream
      source$.dispose();
      condition$.dispose(); // This completes the delayed stream without emitting
    });
  });

  it("should drop values after notifier completes without emitting", async () => {
    const source$: Atom<number> = atom<number>();
    const sourceStream = fromAtom(source$);
    const condition$: Atom<any> = atom<any>();
    const conditionStream = fromAtom(condition$);

    const emittedValues: number[] = [];
    const delayedStream = sourceStream.pipe(delayUntil(conditionStream));

    await new Promise<void>((resolve, reject) => {
      delayedStream.subscribe({
        next: (value) => emittedValues.push(value),
        complete: () => {
          try {
            expect(emittedValues).toEqual([]);
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        error: (err) => reject(new Error(`Stream failed: ${err}`)),
      });

      condition$.dispose(); // closes gate without emitting
      source$.set(1);
      source$.set(2);
      source$.dispose();
    });
  });

  it("should emit the source stream values after condition stream emits", async () => {
    const source$: Atom<number> = atom<number>();
    const sourceStream = fromAtom(source$);
    const condition$: Atom<any> = atom<any>();
    const conditionStream = fromAtom(condition$);

    const emittedValues: number[] = [];
    const delayedStream = sourceStream.pipe(delayUntil(conditionStream));

    await new Promise<void>((resolve, reject) => {
      delayedStream.subscribe({
        next: (value) => emittedValues.push(value),
        complete: () => {
          try {
            expect(emittedValues).toEqual([10, 20, 30]); // Expectation is now waited for
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        error: (err) => reject(new Error(`Stream failed: ${err}`)),
      });

      condition$.set("start"); // Start the emission
      source$.set(10);
      source$.set(20);
      source$.set(30);

      // FIX: Must complete the source stream
      source$.dispose();
      condition$.dispose();
    });
  });

  it("should handle error in source stream", async () => {
    const source$: Atom<number> = atom<number>();
    const sourceStream = fromAtom(source$);
    const condition$: Atom<any> = atom<any>();
    const conditionStream = fromAtom(condition$);

    // We expect the promise to be rejected
    await expectAsync(new Promise<void>((resolve, reject) => {
      const delayedStream = sourceStream.pipe(delayUntil(conditionStream));

      delayedStream.subscribe({
        next: () => { },
        complete: () => reject(new Error("Stream completed unexpectedly")), // Should not complete
        error: (err) => {
          // If the error callback fires, the test should succeed and resolve/reject logic should handle it
          expect(err.message).toBe("Something went wrong");
          resolve(); // Resolve the promise if the expected error is caught
        },
      });

      source$.set(1);
      source$.setError(new Error("Something went wrong")); // Error in the source stream
      condition$.set("start"); // Too late, stream already errored

      // If the error doesn't happen, the promise will hang unless we reject it after a timeout.
      // Since the error is synchronous here, we rely on the error callback resolving the promise.
    })).toBeResolved(); // Expect the promise to resolve (because we resolved it on successful error handling)
  });

  it("should propagate notifier errors", async () => {
    const source$: Atom<number> = atom<number>();
    const sourceStream = fromAtom(source$);
    const condition$: Atom<any> = atom<any>();
    const conditionStream = fromAtom(condition$);

    await expectAsync(
      new Promise<void>((resolve, reject) => {
        const delayedStream = sourceStream.pipe(delayUntil(conditionStream));

        delayedStream.subscribe({
          next: () => reject(new Error("Should not emit")),
          complete: () => reject(new Error("Should not complete")),
          error: (err) => {
            try {
              expect(err.message).toBe("Notifier failed");
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        });

        source$.set(7);
        condition$.setError(new Error("Notifier failed"));
      })
    ).toBeResolved();
  });

  it("should flush buffer when notifier promise resolves", async () => {
    const source$: Atom<number> = atom<number>();
    const sourceStream = fromAtom(source$);
    const notifierPromise = new Promise<void>((resolve) => setTimeout(resolve, 20));

    const emittedValues: number[] = [];
    const delayedStream = sourceStream.pipe(delayUntil(notifierPromise));

    await new Promise<void>((resolve, reject) => {
      delayedStream.subscribe({
        next: (value) => emittedValues.push(value),
        complete: () => {
          try {
            expect(emittedValues).toEqual([8, 9]);
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        error: (err) => reject(new Error(`Stream failed: ${err}`)),
      });

      source$.set(8);
      source$.set(9);

      setTimeout(() => {
        source$.dispose();
      }, 40);
    });
  });

  it("should complete the stream after both source and condition streams complete", async () => {
    const source$: Atom<number> = atom<number>();
    const sourceStream = fromAtom(source$);
    const condition$: Atom<any> = atom<any>();
    const conditionStream = fromAtom(condition$);

    const emittedValues: number[] = [];
    const delayedStream = sourceStream.pipe(delayUntil(conditionStream));

    await new Promise<void>((resolve, reject) => {
      delayedStream.subscribe({
        next: (value) => emittedValues.push(value),
        complete: () => {
          try {
            expect(emittedValues).toEqual([5, 6, 7]); // Expectation is now waited for
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        error: (err) => reject(new Error(`Stream failed: ${err}`)),
      });

      condition$.set("start"); // Start the emission
      source$.set(5);
      source$.set(6);
      source$.set(7);
      source$.dispose(); // Complete the source stream
      condition$.dispose(); // Complete the condition stream
    });
  });
});

