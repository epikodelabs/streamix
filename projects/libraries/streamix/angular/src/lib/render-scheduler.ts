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
      const id = requestAnimationFrame(() => callback());
      return () => cancelAnimationFrame(id);
    }

    const id = setTimeout(callback, 16);
    return () => clearTimeout(id);
  },
};

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
  private flushing = false;

  constructor(
    private readonly scheduler: RenderScheduler =
      animationFrameRenderScheduler,
  ) {}

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

    if (!this.cancelFrame && !this.flushing) {
      this.cancelFrame = this.scheduler.schedule(() => {
        this.cancelFrame = undefined;
        this.flush();
      });
    }
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
        this.cancelFrame = this.scheduler.schedule(() => {
          this.cancelFrame = undefined;
          this.flush();
        });
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
