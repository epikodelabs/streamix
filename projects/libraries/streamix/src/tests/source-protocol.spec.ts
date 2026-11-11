import {
  atom,
  createAsyncCoordinator,
  createAsyncIterator,
  createAsyncPushable,
  createSubscription,
  DONE,
  from,
  iterate,
  NEXT,
  type SourceCapabilities,
  type StreamixSource,
  type SyncPoll,
} from '@epikodelabs/streamix';

/**
 * Shared contract suite for the internal source protocol
 * (`SourceCapabilities`): every adapter that feeds the coordinator or an
 * operator must satisfy the same poll, buffered-events, terminal-state,
 * readiness and closure behavior. New adapters join by adding a harness
 * entry — the assertions below then apply automatically.
 */

interface ContractHarness {
  /** The adapter under test, viewed through the protocol. */
  source: StreamixSource<any>;
  /** Make one more value available to the adapter. */
  push(value: number): void;
  /** Deliver an error into the adapter; omitted when unsupported. */
  fail?(err: any): void;
  /** Drive the adapter to its terminal state. */
  complete(): void;
  /** Release resources after the test. */
  close(): any;
  /**
   * Translate an available poll/next result into the value stream the
   * contract asserts on. Adapters that yield event objects (for example the
   * coordinator's RunnerEvents) map them to plain values and map the
   * completion event to DONE; adapters yielding values use the identity.
   */
  translate?(result: IteratorResult<any>): IteratorResult<any>;
}

function pollResult(harness: ContractHarness, poll: SyncPoll<any> | undefined): IteratorResult<any> {
  expect(poll?.status).toBe('available');
  const result = (poll as { status: 'available'; result: IteratorResult<any> }).result;
  return harness.translate ? harness.translate(result) : result;
}

function pullResult(harness: ContractHarness, result: IteratorResult<any>): IteratorResult<any> {
  return harness.translate ? harness.translate(result) : result;
}

const harnesses: Array<{ name: string; create: () => ContractHarness }> = [
  {
    name: 'createAsyncPushable',
    create: () => {
      const pushable = createAsyncPushable<number>();
      return {
        source: pushable,
        push: value => { void pushable.push(value); },
        fail: err => pushable.fail(err),
        complete: () => pushable.dispose(),
        close: () => pushable.return?.(),
      };
    },
  },
  {
    name: 'createAsyncIterator',
    create: () => {
      let observer: {
        next(value: number): unknown;
        fail(err: any): unknown;
        complete(): unknown;
      } | undefined;
      const iterator = createAsyncIterator<number>({
        register(o) {
          observer = o;
          return createSubscription();
        },
      })();
      return {
        source: iterator,
        push: value => { observer?.next(value); },
        fail: err => { observer?.fail(err); },
        complete: () => { observer?.complete(); },
        close: () => iterator.return?.(),
      };
    },
  },
  {
    name: 'iterate(atom)',
    create: () => {
      const source = atom<number>();
      const iterator = iterate(source);
      return {
        source: iterator,
        push: value => source.next(value),
        fail: err => source.fail(err),
        complete: () => source.dispose(),
        close: () => iterator.return?.(),
      };
    },
  },
  {
    name: 'createAsyncCoordinator',
    create: () => {
      const inner = createAsyncPushable<number>();
      const coordinator = createAsyncCoordinator<number>([inner]);
      const translate = (result: IteratorResult<any>): IteratorResult<any> => {
        if (result.done) return result;
        const event = result.value;
        if (event?.type === 'complete') return DONE;
        return NEXT(event.value);
      };
      return {
        source: coordinator,
        push: value => { void inner.push(value); },
        complete: () => inner.dispose(),
        close: () => coordinator.return?.(),
        translate,
      };
    },
  },
];

describe('source protocol contract', () => {
  for (const { name, create } of harnesses) {
    describe(name, () => {
      it('delivers buffered values through pollSync in order, then reports unavailable while open', async () => {
        const harness = create();
        try {
          harness.source.pollSync?.(); // prime lazy registration
          harness.push(1);
          harness.push(2);

          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(NEXT(1));
          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(NEXT(2));
          expect(harness.source.pollSync?.()).toEqual({ status: 'unavailable' });
        } finally {
          await harness.close();
        }
      });

      it('reports completion through pollSync and stays terminal', async () => {
        const harness = create();
        try {
          harness.source.pollSync?.();
          harness.push(1);
          harness.complete();

          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(NEXT(1));
          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(DONE);
          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(DONE);
        } finally {
          await harness.close();
        }
      });

      it('keeps held values and terminal state as distinct probes', async () => {
        const harness = create();
        try {
          harness.source.pollSync?.();
          harness.push(1);

          expect(harness.source.hasBufferedEvents?.()).toBeTrue();
          expect(harness.source.isTerminal?.()).toBeFalse();

          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(NEXT(1));
          expect(harness.source.hasBufferedEvents?.()).toBeFalse();
          expect(harness.source.isTerminal?.()).toBeFalse();

          harness.complete();
          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(DONE);
          // Drained terminal state: nothing held anymore, but terminal.
          expect(harness.source.hasBufferedEvents?.()).toBeFalse();
          expect(harness.source.isTerminal?.()).toBeTrue();
        } finally {
          await harness.close();
        }
      });

      it('wakes the registered readiness listener per event and stops after unregister', async () => {
        const harness = create();
        if (!harness.source.onReady) {
          expect(harness.source.onReady).toBeUndefined();
          await harness.close();
          return;
        }
        try {
          harness.source.pollSync?.();

          const events: number[] = [];
          let counter = 0;
          const unwire = harness.source.onReady?.(() => { events.push(++counter); });
          expect(unwire).toBeDefined();

          harness.push(1);
          expect(events).toEqual([1]);

          unwire!();
          harness.push(2);
          expect(events).toEqual([1]);

          // Both values are still delivered through pulls.
          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(NEXT(1));
          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(NEXT(2));
        } finally {
          await harness.close();
        }
      });

      it('resolves an async pull when a new event arrives after an unavailable poll', async () => {
        const harness = create();
        try {
          harness.source.pollSync?.();
          const pending = harness.source.next();
          harness.push(7);
          expect(pullResult(harness, await pending)).toEqual(NEXT(7));
        } finally {
          await harness.close();
        }
      });

      it('does not report empty completion as buffered data before the terminal pull', async () => {
        const harness = create();
        try {
          harness.source.pollSync?.();
          harness.complete();
          expect(harness.source.isTerminal?.()).toBeTrue();
          // A coordinator emits an actual completion event; other adapters
          // keep only a terminal flag once their values have drained.
          if (!harness.translate) expect(harness.source.hasBufferedEvents?.()).toBeFalse();
          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(DONE);
        } finally { await harness.close(); }
      });

      it('keeps readiness registrations independent when callbacks are reused', async () => {
        const harness = create();
        if (!harness.source.onReady) {
          expect(harness.source.onReady).toBeUndefined();
          await harness.close();
          return;
        }
        harness.source.pollSync?.();
        const listener = jasmine.createSpy('ready');
        const stopFirst = harness.source.onReady(listener);
        const stopSecond = harness.source.onReady(listener);
        try {
          harness.push(1);
          expect(listener).toHaveBeenCalledTimes(2);
          stopFirst();
          stopFirst();
          harness.push(2);
          expect(listener).toHaveBeenCalledTimes(3);
          stopSecond();
          harness.push(3);
          expect(listener).toHaveBeenCalledTimes(3);
        } finally { stopFirst(); stopSecond(); await harness.close(); }
      });

      it('isolates readiness observer errors from source delivery', async () => {
        const harness = create();
        if (!harness.source.onReady) {
          expect(harness.source.onReady).toBeUndefined();
          await harness.close();
          return;
        }
        harness.source.pollSync?.();
        const stopFailing = harness.source.onReady(() => { throw new Error('observer failure'); });
        const healthy = jasmine.createSpy('healthy');
        const stopHealthy = harness.source.onReady(healthy);
        try {
          expect(() => harness.push(8)).not.toThrow();
          expect(healthy).toHaveBeenCalledTimes(1);
          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(NEXT(8));
        } finally { stopFailing(); stopHealthy(); await harness.close(); }
      });

      it('announces completion even when an asynchronous pull is waiting', async () => {
        const harness = create();
        if (!harness.source.onReady) {
          expect(harness.source.onReady).toBeUndefined();
          await harness.close();
          return;
        }
        const ready = jasmine.createSpy('ready');
        const stop = harness.source.onReady(ready);
        try {
          harness.source.pollSync?.();
          const pending = harness.source.next();
          harness.complete();
          expect(pullResult(harness, await pending)).toEqual(DONE);
          expect(ready).toHaveBeenCalledTimes(1);
        } finally { stop(); await harness.close(); }
      });

      it('reports the terminal state after return()', async () => {
        const harness = create();
        try {
          harness.source.pollSync?.();
          await harness.source.return?.();
          expect(harness.source.isTerminal?.()).toBeTrue();
          expect(pollResult(harness, harness.source.pollSync?.())).toEqual(DONE);
        } finally {
          await harness.close();
        }
      });

      it('reports a pending error by throwing from pollSync', async () => {
        const harness = create();
        if (!harness.fail) {
          expect(harness.fail).toBeUndefined();
          await harness.close();
          return;
        }
        try {
          harness.source.pollSync?.();
          harness.fail(new Error('contract boom'));
          expect(() => harness.source.pollSync?.()).toThrowError('contract boom');
        } finally {
          await harness.close();
        }
      });
    });
  }

  it('coordinator converts source errors into error events', async () => {
    const inner = createAsyncPushable<number>();
    const coordinator = createAsyncCoordinator<number>([inner]);
    try {
      coordinator.pollSync();
      inner.fail(new Error('event boom'));
      const poll = coordinator.pollSync();
      expect(poll.status).toBe('available');
      const event = (poll as { status: 'available'; result: IteratorResult<{ type: string; error: any }> }).result.value!;
      expect(event.type).toBe('error');
      expect(event.error.message).toBe('event boom');
    } finally {
      await coordinator.return?.();
    }
  });

  it('drives plain async iterators without any capabilities through the async pull', async () => {
    const coordinator = createAsyncCoordinator<number>([
      { next: async () => NEXT(5) },
    ]);
    try {
      expect(await coordinator.next()).toEqual(
        NEXT({ type: 'value' as const, value: 5, sourceIndex: 0 })
      );
    } finally {
      await coordinator.return?.();
    }
  });
});

describe('from() lazy synchronous sequence contract', () => {
  it('reports terminal state after an asynchronous source completes', async () => {
    const atom = from((async function* () { yield 9; })());
    const source: StreamixSource<number> = atom[Symbol.asyncIterator]();
    try {
      expect(await source.next()).toEqual(NEXT(9));
      expect(source.isTerminal?.()).toBeFalse();
      expect(await source.next()).toEqual(DONE);
      expect(source.isTerminal?.()).toBeTrue();
      expect(source.hasBufferedEvents?.()).toBeFalse();
      expect(source.pollSync?.()).toEqual({ status: 'available', result: DONE });
    } finally { await source.return?.(); atom.dispose(); }
  });

  it('produces remaining items on demand without ever reporting them buffered', () => {
    const source = from([1, 2])[Symbol.asyncIterator]() as AsyncIterator<number> & SourceCapabilities<number>;

    // Lazily producible, but nothing is held: the distinction the protocol
    // exists to enforce.
    expect(source.hasBufferedEvents?.()).toBeFalse();
    expect(source.isTerminal?.()).toBeFalse();

    expect(source.pollSync?.()).toEqual({ status: 'available', result: NEXT(1) });
    expect(source.hasBufferedEvents?.()).toBeFalse();

    expect(source.pollSync?.()).toEqual({ status: 'available', result: NEXT(2) });

    // A finite synchronous sequence completes instead of reporting unavailable.
    expect(source.pollSync?.()).toEqual({ status: 'available', result: DONE });
    expect(source.pollSync?.()).toEqual({ status: 'available', result: DONE });
    expect(source.isTerminal?.()).toBeTrue();
    expect(source.hasBufferedEvents?.()).toBeFalse();
  });
});
