import { DONE, getIteratorEmissionStamp, setIteratorEmissionStamp } from "../abstractions";
import { insertOrdered, type QueueItem } from "./helpers";

type RunnerEvent<T> =
  | { type: "value"; value: T; sourceIndex: number }
  | { type: "complete"; sourceIndex: number }
  | { type: "error"; error: any; sourceIndex: number };

export function createAsyncCoordinator(
  sources: AsyncIterator<any>[]
): AsyncIterator<RunnerEvent<any>> & {
  __tryNext?: () => IteratorResult<RunnerEvent<any>> | null;
  __hasBufferedValues?: () => boolean;
} {
  type CoordinatorQueueItem = QueueItem<RunnerEvent<any>> & {
    sourceIndex: number;
  };

  const queue: CoordinatorQueueItem[] = [];
  const completed = new Array(sources.length).fill(false);
  const pulling = new Array(sources.length).fill(false);
  const pendingPulls = new Array(sources.length).fill(false);

  let waitingResolve: ((v: any) => void) | null = null;
  let isDraining = false;
  let nextStamp = 1;

  const allDone = () => completed.every(Boolean);

  function pushEvent(event: RunnerEvent<any>, stamp: number, sourceIndex: number) {
    insertOrdered(queue, {
      result: { done: false, value: event },
      stamp,
      sourceIndex
    });
  }

  function notify() {
    if (!waitingResolve) return;

    if (queue.length > 0) {
      const item = queue.shift()!;
      const res = waitingResolve;
      waitingResolve = null;
      setIteratorEmissionStamp(iterator, item.stamp);
      res(item.result);
    } else if (allDone()) {
      const res = waitingResolve;
      waitingResolve = null;
      res(DONE);
    }
  }

  function pullAsync(i: number) {
    // CRITICAL: Don't start a new pull if already pulling or completed
    if (completed[i] || pulling[i]) return;
    
    pulling[i] = true;
    pendingPulls[i] = false;
    const src: any = sources[i];
    
    src.next().then(
      (r: IteratorResult<any>) => {
        pulling[i] = false;
        
        // Don't process if source was completed during the async wait
        if (completed[i]) return;

        const stamp = getIteratorEmissionStamp(src) ?? nextStamp++;

        if (r.done) {
          completed[i] = true;
          pushEvent({ type: "complete", sourceIndex: i }, stamp, i);
        } else {
          pushEvent({ type: "value", value: r.value, sourceIndex: i }, stamp, i);
        }

        notify();
        
        // CRITICAL: Only schedule next pull if there are more values AND not already pulling
        // AND not completed AND there's a pending pull request
        if (!completed[i] && !pulling[i] && pendingPulls[i]) {
          pendingPulls[i] = false;
          Promise.resolve().then(() => pullAsync(i));
        }
      },
      (err: any) => {
        pulling[i] = false;
        if (completed[i]) return;
        
        completed[i] = true;
        const stamp = getIteratorEmissionStamp(src) ?? nextStamp++;
        pushEvent({ type: "error", error: err, sourceIndex: i }, stamp, i);
        notify();
      }
    );
  }

  function drainSources() {
    // CRITICAL: Prevent recursive drains
    if (isDraining) return;
    isDraining = true;

    try {
      for (let i = 0; i < sources.length; i++) {
        if (completed[i]) continue;

        const src: any = sources[i];

        // Sync sources - DRAIN ALL VALUES
        if (src.__tryNext) {
          try {
            let r;
            while ((r = src.__tryNext())) {
              const stamp = getIteratorEmissionStamp(src) ?? nextStamp++;

              if (r.done) {
                completed[i] = true;
                pushEvent({ type: "complete", sourceIndex: i }, stamp, i);
                break;
              } else {
                pushEvent({ type: "value", value: r.value, sourceIndex: i }, stamp, i);
              }
            }
          } catch (err) {
            completed[i] = true;
            const stamp = getIteratorEmissionStamp(src) ?? nextStamp++;
            pushEvent({ type: "error", error: err, sourceIndex: i }, stamp, i);
          }
        } 
        // Async sources
        else {
          // CRITICAL: Mark that we need a pull, but don't start it if already pulling
          pendingPulls[i] = true;
          if (!pulling[i] && !completed[i]) {
            pendingPulls[i] = false;
            pullAsync(i);
          }
        }
      }
    } finally {
      isDraining = false;
    }

    notify();
  }

  // Wire up push notifications
  for (const src of sources as any[]) {
    const orig = src.__onPush;
    src.__onPush = () => {
      orig?.();
      // Schedule drain in next microtask to prevent recursion
      Promise.resolve().then(() => drainSources());
    };
  }

  const iterator: any = {
    next() {
      drainSources();

      if (queue.length > 0) {
        const item = queue.shift()!;
        setIteratorEmissionStamp(iterator, item.stamp);
        return Promise.resolve(item.result);
      }

      if (allDone()) return Promise.resolve(DONE);

      return new Promise(res => {
        waitingResolve = res;
      });
    },

    __tryNext() {
      drainSources();

      if (queue.length > 0) {
        const item = queue.shift()!;
        setIteratorEmissionStamp(iterator, item.stamp);
        return item.result;
      }

      return allDone() ? DONE : null;
    },

    __hasBufferedValues() {
      return queue.length > 0 || allDone();
    },

    async return() {
      // Mark all as completed immediately
      for (let i = 0; i < completed.length; i++) {
        completed[i] = true;
        pulling[i] = false;
        pendingPulls[i] = false;
      }

      const safe = (s: any) => {
        if (!s?.return) return Promise.resolve();
        try {
          return Promise.resolve(s.return()).catch(() => {});
        } catch {
          return Promise.resolve();
        }
      };

      await Promise.all(sources.map(safe));
      
      if (waitingResolve) {
        waitingResolve(DONE);
        waitingResolve = null;
      }
      
      return DONE;
    }
  };

  // Initial drain - schedule to prevent blocking
  Promise.resolve().then(() => drainSources());

  return iterator;
}