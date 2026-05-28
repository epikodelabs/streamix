/**
 * Worker DOM Experiment — Game of Life state runs in a worker actor,
 * main thread renders with Blockdom.
 *
 * Architecture:
 *   • domActor (worker) : maintains grid state, sends plain state to main
 *   • WorkerDomService   : Angular service wrapping the actor
 *   • WorkerDomComponent : receives state, renders with Blockdom
 */
import { Injectable, OnDestroy } from '@angular/core';
import { createBehaviorSubject, createSubject } from '@epikodelabs/streamix';
import { actor, main, ActorBusMessage, WorkerUtils } from '@epikodelabs/streamix/coroutines';

// ===== SHARED TYPES =====

export type WorkerStateMessage = {
  type: 'state';
  grid: boolean[][];
  generation: number;
  rows: number;
  cols: number;
};

export type GridState = {
  grid: boolean[][];
  rows: number;
  cols: number;
  generation: number;
};

// ===== WORKER-SIDE GRID / CONWAY LOGIC =====

function emptyGrid(rows: number, cols: number): boolean[][] {
  const grid: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c++) row.push(false);
    grid.push(row);
  }
  return grid;
}

function cloneGrid(grid: boolean[][]): boolean[][] {
  return grid.map(row => row.slice());
}

function conwayStep(grid: boolean[][]): boolean[][] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const next = emptyGrid(rows, cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let neighbors = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc]) {
            neighbors++;
          }
        }
      }
      const alive = grid[r][c];
      next[r][c] = alive ? (neighbors === 2 || neighbors === 3) : (neighbors === 3);
    }
  }
  return next;
}

function toggleCell(grid: boolean[][], key: string): boolean[][] {
  const next = cloneGrid(grid);
  const m = key.match(/^cell-(\d+)-(\d+)$/);
  if (m) {
    const r = parseInt(m[1], 10);
    const c = parseInt(m[2], 10);
    if (r >= 0 && r < next.length && c >= 0 && c < next[0].length) {
      next[r][c] = !next[r][c];
    }
  }
  return next;
}

function randomizeGrid(grid: boolean[][], count: number): boolean[][] {
  const next = cloneGrid(grid);
  const rows = next.length;
  const cols = next[0]?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    next[r][c] = true;
  }
  return next;
}

function clearGrid(grid: boolean[][]): boolean[][] {
  return emptyGrid(grid.length, grid[0]?.length ?? 0);
}

function emitState(
  utils: WorkerUtils<any, any, any, any>,
  state: { grid: boolean[][]; generation: number; rows: number; cols: number }
) {
  utils.outbox.send('main', 'state', {
    type: 'state',
    grid: state.grid,
    generation: state.generation,
    rows: state.rows,
    cols: state.cols,
  } as WorkerStateMessage);
}

// ===== ACTOR BEHAVIOR =====

interface DomActorState {
  grid: boolean[][];
  rows: number;
  cols: number;
  generation: number;
}

function domActorBehavior(
  msg: any,
  state: DomActorState,
  utils: WorkerUtils<any, any, any, any>
) {
  if (msg.kind !== 'actor-bus') return state;

  let nextState = state;
  let shouldEmit = false;

  if (msg.topic === 'init') {
    const payload = msg.payload as { rows: number; cols: number };
    nextState = {
      grid: emptyGrid(payload.rows, payload.cols),
      rows: payload.rows,
      cols: payload.cols,
      generation: 0,
    };
    shouldEmit = true;
  }

  if (msg.topic === 'click') {
    const key = msg.payload as string;
    nextState = {
      ...nextState,
      grid: toggleCell(nextState.grid, key),
    };
    shouldEmit = true;
  }

  if (msg.topic === 'step') {
    nextState = {
      ...nextState,
      grid: conwayStep(nextState.grid),
      generation: nextState.generation + 1,
    };
    shouldEmit = true;
  }

  if (msg.topic === 'randomize') {
    const count = (msg.payload as any)?.count ?? 20;
    nextState = {
      ...nextState,
      grid: randomizeGrid(nextState.grid, count),
    };
    shouldEmit = true;
  }

  if (msg.topic === 'clear') {
    nextState = {
      ...nextState,
      grid: clearGrid(nextState.grid),
      generation: 0,
    };
    shouldEmit = true;
  }

  if (shouldEmit) {
    emitState(utils, nextState);
  }

  return nextState;
}

// ===== ACTOR INSTANCE =====

const domActor = actor('dom-renderer', domActorBehavior, {
  grid: [],
  rows: 0,
  cols: 0,
  generation: 0,
}, emptyGrid, cloneGrid, conwayStep, toggleCell, randomizeGrid, clearGrid, emitState, domActorBehavior);

// ===== ANGULAR SERVICE =====

export type DomStats = {
  generation: number;
  renderTime: number;
  nodeCount: number;
};

@Injectable({ providedIn: 'root' })
export class WorkerDomService implements OnDestroy {
  private stateSubject = createSubject<WorkerStateMessage>();
  state$ = this.stateSubject;

  private gridStateSubject = createBehaviorSubject<GridState>({
    grid: [],
    rows: 0,
    cols: 0,
    generation: 0,
  });
  gridState$ = this.gridStateSubject;

  private unsub: (() => void) | null = null;
  private destroyed = false;

  constructor() {
    this.unsub = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.from !== 'dom-renderer') return;

      if (message.topic === 'state') {
        const payload = message.payload as WorkerStateMessage;
        this.stateSubject.next(payload);
        this.gridStateSubject.next({
          grid: payload.grid,
          rows: payload.rows,
          cols: payload.cols,
          generation: payload.generation,
        });
      }
    });
  }

  init(rows: number, cols: number) {
    if (this.destroyed) return;
    main.outbox.send(domActor, 'init', { rows, cols });
  }

  click(key: string) {
    if (this.destroyed) return;
    main.outbox.send(domActor, 'click', key);
  }

  step() {
    if (this.destroyed) return;
    main.outbox.send(domActor, 'step', null);
  }

  randomize(count = 20) {
    if (this.destroyed) return;
    main.outbox.send(domActor, 'randomize', { count });
  }

  clear() {
    if (this.destroyed) return;
    main.outbox.send(domActor, 'clear', null);
  }

  ngOnDestroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsub?.();
    this.unsub = null;
    main.outbox.stop(domActor);
  }
}
