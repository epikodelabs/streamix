/**
 * Cancels scheduled renderer work.
 */
export type CancelRender = () => void;

export interface RenderScheduler {
  schedule(callback: () => void): CancelRender;
}

export const animationFrameRenderScheduler: RenderScheduler = {
  schedule(callback: () => void): CancelRender {
    if (typeof requestAnimationFrame === 'function') {
      // Browsers pause rAF in hidden documents. Keep frame coalescing in the
      // foreground, but guarantee eventual delivery for live state in a
      // background tab as well. Whichever callback wins cancels the other.
      let complete = false;
      let frame = 0;
      let fallback: ReturnType<typeof setTimeout> | undefined;
      const run = () => {
        if (complete) return;
        complete = true;
        cancelAnimationFrame(frame);
        if (fallback !== undefined) clearTimeout(fallback);
        callback();
      };

      frame = requestAnimationFrame(run);
      fallback = setTimeout(run, 100);

      return () => {
        complete = true;
        cancelAnimationFrame(frame);
        if (fallback !== undefined) clearTimeout(fallback);
      };
    }

    const id = setTimeout(callback, 16);
    return () => clearTimeout(id);
  },
};

export interface OutsideAngularBoundary {
  runOutsideAngular<T>(callback: () => T): T;
}

/**
 * Wraps a frame scheduler so both registration and execution happen outside
 * Angular's zone. This wrapper is installed only when a Zone.js-backed
 * application explicitly enables sx zone scheduling; zoneless applications
 * keep the native renderer scheduler and never construct this boundary.
 */
export function createOutsideAngularRenderScheduler(
  boundary: OutsideAngularBoundary,
  delegate: RenderScheduler = animationFrameRenderScheduler,
): RenderScheduler {
  const scheduler: RenderScheduler = {
    schedule(callback: () => void): CancelRender {
      return boundary.runOutsideAngular(() =>
        delegate.schedule(() => boundary.runOutsideAngular(callback)),
      );
    },
  };

  // Marks the execution boundary so the scheduler can tell an opted-in zone
  // application from one that forgot `provideSxZoneScheduling()`.
  Object.defineProperty(scheduler, 'ɵsxOutsideAngular', { value: true });

  return scheduler;
}

export interface ScheduledBinding {
  readonly id: number;
  markDirty(): void;
  destroy(): void;
}

export class RendererScheduler {
  private readonly bindings: Array<(() => void) | undefined> = [];
  private readonly dirtyFlags: boolean[] = [];
  private readonly generations: number[] = [];
  private readonly dirtyIds: number[] = [];
  private readonly dirtyGenerations: number[] = [];
  private readonly freeIds: number[] = [];

  private cancelFrame?: CancelRender;
  private schedulingFrame = false;
  private flushing = false;
  private zoneWarned = false;

  constructor(
    private scheduler: RenderScheduler =
      animationFrameRenderScheduler,
  ) {}

  /**
   * Replaces the frame scheduler used for future flushes. If a frame is
   * already pending it is rescheduled through the new scheduler so the
   * execution boundary is applied consistently.
   */
  setScheduler(scheduler: RenderScheduler): void {
    if (this.scheduler === scheduler) {
      return;
    }

    this.cancelFrame?.();
    this.cancelFrame = undefined;
    this.scheduler = scheduler;

    if (this.dirtyIds.length > 0 && !this.flushing) {
      this.scheduleFlush();
    }
  }

  /**
   * Restores the default frame scheduler, but only while `scheduler` is the
   * installed one. The zone boundary is process-global: a second application
   * that configured its own boundary takes ownership, so destroying the first
   * application must not tear the boundary away from the survivor.
   */
  restoreScheduler(scheduler: RenderScheduler): void {
    if (this.scheduler !== scheduler) {
      return;
    }

    this.setScheduler(animationFrameRenderScheduler);
  }

  register(flush: () => void): ScheduledBinding {
    const id = this.freeIds.pop() ?? this.bindings.length;
    const generation = (this.generations[id] ?? 0) + 1;

    this.generations[id] = generation;
    this.bindings[id] = flush;
    this.dirtyFlags[id] = false;

    let destroyed = false;

    return {
      id,
      markDirty: (): void => {
        if (destroyed) return;
        this.markDirty(id, generation);
      },
      destroy: (): void => {
        if (destroyed) return;
        destroyed = true;
        this.unregister(id, generation);
      },
    };
  }

  flushNow(): void {
    this.cancelFrame?.();
    this.cancelFrame = undefined;
    this.flush();
  }

  get pendingCount(): number {
    let count = 0;

    for (let index = 0; index < this.dirtyIds.length; index += 1) {
      const id = this.dirtyIds[index];
      const generation = this.dirtyGenerations[index];

      if (
        this.generations[id] === generation &&
        this.dirtyFlags[id] &&
        this.bindings[id]
      ) {
        count += 1;
      }
    }

    return count;
  }

  /**
   * A Zone.js application that never installed `provideSxZoneScheduling()`
   * runs every frame callback inside Angular's zone, so each Streamix update
   * drags a global change-detection pass along. Detect the situation once and
   * say so; nothing is patched implicitly.
   */
  private warnAboutZoneScheduling(): void {
    if (this.zoneWarned) {
      return;
    }

    const zone = (globalThis as { Zone?: unknown }).Zone;
    const outsideAngular =
      (this.scheduler as { ɵsxOutsideAngular?: boolean }).ɵsxOutsideAngular ===
      true;

    if (zone === undefined || outsideAngular) {
      return;
    }

    this.zoneWarned = true;

    console.warn(
      '[streamix] Renderer updates are scheduled inside Zone.js without ' +
      'provideSxZoneScheduling(), so every Streamix update triggers an ' +
      'Angular change-detection pass. Add provideSxZoneScheduling() to the ' +
      'application providers to keep compiled updates outside the zone.',
    );
  }

  private markDirty(
    id: number,
    generation: number,
  ): void {
    if (
      this.generations[id] !== generation ||
      this.dirtyFlags[id]
    ) {
      return;
    }

    this.dirtyFlags[id] = true;
    this.dirtyIds.push(id);
    this.dirtyGenerations.push(generation);

    this.warnAboutZoneScheduling();

    if (!this.cancelFrame && !this.flushing) {
      this.scheduleFlush();
    }
  }

  /**
   * Schedules the next flush through the frame scheduler.
   *
   * A scheduler that invokes its callback synchronously has already consumed
   * the frame by the time schedule() returns, so the returned cancel handle
   * is stale: storing it would leave cancelFrame set forever and every later
   * markDirty() would believe a frame is still pending. The scheduling flag
   * spans only the schedule() call and distinguishes a synchronous callback
   * from an asynchronous one; a pending frame is guarded by cancelFrame.
   */
  private scheduleFlush(): void {
    if (this.cancelFrame || this.flushing || this.schedulingFrame) {
      return;
    }

    this.schedulingFrame = true;

    const handle = this.scheduler.schedule(() => {
      this.schedulingFrame = false;
      this.cancelFrame = undefined;
      this.flush();
    });

    if (this.schedulingFrame) {
      // The callback has not run yet (asynchronous scheduling): the frame is
      // pending and the returned handle is live.
      this.cancelFrame = handle;
    }
    // A synchronous callback cleared the flag itself, consumed the frame,
    // and left nothing pending: the returned handle is stale and must be
    // dropped.

    this.schedulingFrame = false;
  }

  private flush(): void {
    if (this.flushing || this.dirtyIds.length === 0) {
      return;
    }

    this.flushing = true;

    try {
      let index = 0;

      while (index < this.dirtyIds.length) {
        const id = this.dirtyIds[index];
        const generation = this.dirtyGenerations[index];
        index += 1;

        if (
          this.generations[id] !== generation ||
          !this.dirtyFlags[id]
        ) {
          continue;
        }

        this.dirtyFlags[id] = false;

        try {
          this.bindings[id]?.();
        } catch (error) {
          // Report and continue: one failing consumer must not delay the
          // other queued bindings or leak the error out of the frame
          // callback. Its own emissions mark it dirty again; it is
          // deliberately not re-marked here, which would retry (and
          // re-throw) every frame while the failure persists.
          console.error(`sx renderer binding ${id} flush failed.`, error);
        }
      }

      this.dirtyIds.length = 0;
      this.dirtyGenerations.length = 0;
    } finally {
      this.flushing = false;

      if (this.dirtyIds.length > 0 && !this.cancelFrame) {
        this.scheduleFlush();
      }
    }
  }

  private unregister(
    id: number,
    generation: number,
  ): void {
    if (this.generations[id] !== generation) {
      return;
    }

    this.bindings[id] = undefined;
    this.dirtyFlags[id] = false;
    this.freeIds.push(id);
  }
}

export const rendererScheduler = new RendererScheduler();
