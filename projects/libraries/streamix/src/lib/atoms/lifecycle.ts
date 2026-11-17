import type { MaybePromise } from "./operator";

type Cleanup = () => MaybePromise<void>;
export type AtomRetirement = "idle" | "complete" | "error" | "dispose";

export interface AtomLifecycleSession {
  readonly generation: number;
  readonly active: boolean;
}

interface Session extends AtomLifecycleSession {
  active: boolean;
  cleanup?: Cleanup;
}

export interface AtomLifecycleAdapter {
  start(session: AtomLifecycleSession): MaybePromise<void | Cleanup>;
  release?(session: AtomLifecycleSession, reason: AtomRetirement): MaybePromise<void>;
  /** Called synchronously on disposal; await released before dependent cleanup. */
  dispose?(released: Promise<void>): MaybePromise<void>;
  error?(error: unknown, session: AtomLifecycleSession): void;
}

/** Owns producer sessions and consumer policy, independently of atom delivery. */
export class AtomLifecycle {
  private current?: Session;
  private generation = 0;
  private subscribers = 0;
  private references = 0;
  private terminalReason?: "complete" | "error";
  private readonly completionListeners = new Set<() => void>();
  private disposal?: Promise<void>;
  private releases = new Set<Promise<void>>();
  private activated = false;

  constructor(
    private readonly adapter: AtomLifecycleAdapter,
    private readonly onIdle: "dispose" | "stop" | "keepAlive" = "dispose",
  ) {}

  get disposed(): boolean { return this.disposal !== undefined; }
  get started(): boolean { return this.activated; }
  get completed(): boolean { return this.terminalReason === "complete"; }
  get subscriberCount(): number { return this.subscribers; }

  canEmit(session: AtomLifecycleSession): boolean {
    return !this.disposed && !this.terminalReason && this.current === session && session.active;
  }

  activate(): void {
    if (this.disposed || this.terminalReason || this.current) return;
    const session: Session = { generation: ++this.generation, active: true };
    this.current = session;
    this.activated = true;
    try {
      const result = this.adapter.start(session);
      if (typeof result === "function") this.adoptCleanup(session, result);
      else if (result) {
        void Promise.resolve(result).then(
          cleanup => { if (cleanup) this.adoptCleanup(session, cleanup); },
          error => this.reportError(error, session),
        );
      }
    } catch (error) { this.reportError(error, session); }
  }

  addSubscriber(activate = true): void {
    if (this.disposed) return;
    this.subscribers++;
    if (activate) this.activate();
  }

  removeSubscriber(): Promise<void> {
    if (this.subscribers === 0) return Promise.resolve();
    this.subscribers--;
    return this.retireIfIdle();
  }

  retain(activate = true): void {
    if (this.disposed) return;
    this.references++;
    if (activate) this.activate();
  }

  releaseRef(): Promise<void> {
    if (this.references === 0) return Promise.resolve();
    this.references--;
    return this.retireIfIdle();
  }

  onComplete(listener: () => void): () => void {
    if (this.completed) { try { listener(); } catch {} }
    else if (!this.disposed && !this.terminalReason) this.completionListeners.add(listener);
    return () => { this.completionListeners.delete(listener); };
  }

  complete(reason: "complete" | "error" = "complete"): Promise<void> {
    if (this.terminalReason || this.disposed) return this.settled();
    this.terminalReason = reason;
    const released = this.retire(reason);
    if (reason === "complete") {
      for (const listener of [...this.completionListeners]) {
        try { listener(); } catch { /* Completion observers cannot prevent teardown. */ }
      }
    }
    this.completionListeners.clear();
    return released;
  }

  dispose(reason: AtomRetirement = "dispose"): Promise<void> {
    if (this.disposal) return this.disposal;
    let finish!: () => void;
    this.disposal = new Promise<void>(resolve => { finish = resolve; });
    this.subscribers = 0;
    this.references = 0;
    this.completionListeners.clear();
    const released = this.retire(reason);
    let cleanup: MaybePromise<void>;
    try { cleanup = this.adapter.dispose?.(released); } catch { cleanup = undefined; }
    void Promise.allSettled([released, cleanup]).then(() => finish());
    return this.disposal;
  }

  /** Includes cleanup adopted after a producer was already retired. */
  private async settled(): Promise<void> {
    while (this.releases.size) await Promise.all([...this.releases]);
  }

  private retireIfIdle(): Promise<void> {
    // Detaching a terminal consumer must not dispose retained successful state.
    if (this.completed) return this.settled();
    if (this.subscribers || this.references || this.onIdle === "keepAlive") return Promise.resolve();
    return this.onIdle === "dispose" ? this.dispose("idle") : this.retire("idle");
  }

  private retire(reason: AtomRetirement): Promise<void> {
    const session = this.current;
    if (!session) return this.settled();
    this.current = undefined;
    session.active = false;
    // Register retirement before adapter callbacks: they may reenter dispose().
    let finish!: () => void;
    const released = this.track(new Promise<void>(resolve => { finish = resolve; }));
    const tasks: MaybePromise<void>[] = [];
    try { tasks.push(this.adapter.release?.(session, reason)); } catch {}
    if (session.cleanup) {
      const cleanup = session.cleanup;
      session.cleanup = undefined;
      try { tasks.push(cleanup()); } catch {}
    }
    void Promise.allSettled(tasks).then(() => finish());
    return released;
  }

  private adoptCleanup(session: Session, cleanup: Cleanup): void {
    if (this.canEmit(session)) session.cleanup = cleanup;
    else {
      try { this.track(Promise.resolve(cleanup())); } catch {}
    }
  }

  private track(task: Promise<void>): Promise<void> {
    const safe = task.catch(() => {});
    this.releases.add(safe);
    void safe.then(() => this.releases.delete(safe));
    return safe;
  }

  private reportError(error: unknown, session: Session): void {
    if (!this.canEmit(session)) return;
    try { this.adapter.error?.(error, session); } catch {}
    if (this.canEmit(session)) void this.complete("error");
  }
}
