/**
 * Worker DOM Experiment — VDOM diffing inside an actor, synced to the real DOM
 *
 * Architecture:
 *   • domActor (worker) : maintains grid state + previous VDOM, computes diffs,
 *                         emits patches to main thread
 *   • WorkerDomService   : Angular service that wraps the actor, exposes rx
 *   • WorkerDomComponent : applies patches to a real DOM container, forwards clicks
 *
 * The actor behavior and all its helpers are self-contained so they can be
 * serialized into the worker script by streamix.
 */
import { Injectable, OnDestroy } from '@angular/core';
import { createBehaviorSubject, createSubject } from '@epikodelabs/streamix';
import { actor, main, ActorBusMessage, WorkerUtils } from '@epikodelabs/streamix/coroutines';

// ===== SHARED TYPES =====

export type VNode =
  | { type: 'element'; tag: string; key: string; props: Record<string, any>; children: VNode[] }
  | { type: 'text'; key: string; content: string };

export type Patch =
  | { op: 'createElement'; key: string; tag: string; parentKey: string | null; index: number; props: Record<string, any> }
  | { op: 'createText'; key: string; content: string; parentKey: string; index: number }
  | { op: 'remove'; key: string }
  | { op: 'setText'; key: string; content: string }
  | { op: 'setProp'; key: string; name: string; value: any }
  | { op: 'removeProp'; key: string; name: string }
  | { op: 'move'; key: string; parentKey: string; index: number };

export type DomPatchMessage = {
  type: 'patches';
  patches: Patch[];
  stats: {
    vdomNodes: number;
    renderTime: number;
    diffTime: number;
    patchCount: number;
    generation: number;
  };
};

export type GridState = {
  grid: boolean[][];
  rows: number;
  cols: number;
  generation: number;
};

// ===== WORKER-SIDE VDOM ENGINE (self-contained) =====

function h(tag: string, key: string, props: Record<string, any>, children: VNode[]): VNode {
  return { type: 'element', tag, key, props, children };
}

function t(key: string, content: string): VNode {
  return { type: 'text', key, content };
}

function countNodes(node: VNode | null): number {
  if (!node) return 0;
  if (node.type === 'text') return 1;
  let count = 1;
  for (const child of node.children) count += countNodes(child);
  return count;
}

function diffProps(key: string, oldProps: Record<string, any>, newProps: Record<string, any>, patches: Patch[]) {
  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (const name of allKeys) {
    if (name === 'children') continue;
    const oldVal = oldProps[name];
    const newVal = newProps[name];
    if (newVal === undefined || newVal === null) {
      if (oldVal !== undefined && oldVal !== null) {
        patches.push({ op: 'removeProp', key, name });
      }
    } else if (oldVal !== newVal) {
      patches.push({ op: 'setProp', key, name, value: newVal });
    }
  }
}

function diffChildren(parentKey: string, oldChildren: VNode[], newChildren: VNode[], patches: Patch[]) {
  const oldMap = new Map<string, VNode>();
  for (const child of oldChildren) oldMap.set(child.key, child);

  const usedOld = new Set<string>();
  let lastIndex = 0;

  for (let i = 0; i < newChildren.length; i++) {
    const newChild = newChildren[i];
    const oldChild = oldMap.get(newChild.key);

    if (oldChild && sameType(oldChild, newChild)) {
      usedOld.add(newChild.key);
      const oldIndex = oldChildren.findIndex(c => c.key === newChild.key);
      if (oldIndex < lastIndex) {
        patches.push({ op: 'move', key: newChild.key, parentKey, index: i });
      }
      lastIndex = Math.max(lastIndex, oldIndex);
      diffTrees(oldChild, newChild, patches);
    } else {
      if (newChild.type === 'element') {
        patches.push({ op: 'createElement', key: newChild.key, tag: newChild.tag, parentKey, index: i, props: newChild.props });
        createSubtreePatches(newChild, patches);
      } else {
        patches.push({ op: 'createText', key: newChild.key, content: newChild.content, parentKey, index: i });
      }
    }
  }

  for (const child of oldChildren) {
    if (!usedOld.has(child.key)) {
      patches.push({ op: 'remove', key: child.key });
    }
  }
}

function sameType(a: VNode, b: VNode): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'text') return true;
  return a.tag === (b as any).tag;
}

function diffTrees(prev: VNode | null, next: VNode | null, patches: Patch[]) {
  if (!prev && !next) return;
  if (!prev && next) {
    if (next.type === 'element') {
      patches.push({ op: 'createElement', key: next.key, tag: next.tag, parentKey: null, index: 0, props: next.props });
      createSubtreePatches(next, patches);
    } else {
      patches.push({ op: 'createText', key: next.key, content: next.content, parentKey: '', index: 0 });
    }
    return;
  }
  if (prev && !next) {
    patches.push({ op: 'remove', key: prev.key });
    return;
  }
  if (prev!.type !== next!.type) {
    patches.push({ op: 'remove', key: prev!.key });
    if (next!.type === 'element') {
      patches.push({ op: 'createElement', key: next!.key, tag: next!.tag, parentKey: null, index: 0, props: next!.props });
      createSubtreePatches(next!, patches);
    } else {
      patches.push({ op: 'createText', key: next!.key, content: next!.content, parentKey: null as any, index: 0 });
    }
    return;
  }

  if (prev!.type === 'text') {
    if ((prev as any).content !== (next as any).content) {
      patches.push({ op: 'setText', key: prev!.key, content: (next as any).content });
    }
    return;
  }

  const p = prev as any;
  const n = next as any;

  if (p.tag !== n.tag) {
    patches.push({ op: 'remove', key: p.key });
    patches.push({ op: 'createElement', key: n.key, tag: n.tag, parentKey: null, index: 0, props: n.props });
    createSubtreePatches(n, patches);
    return;
  }

  diffProps(p.key, p.props, n.props, patches);
  diffChildren(p.key, p.children, n.children, patches);
}

function createSubtreePatches(node: VNode, patches: Patch[]) {
  if (node.type === 'text') return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === 'element') {
      patches.push({ op: 'createElement', key: child.key, tag: child.tag, parentKey: node.key, index: i, props: child.props });
      createSubtreePatches(child, patches);
    } else {
      patches.push({ op: 'createText', key: child.key, content: child.content, parentKey: node.key, index: i });
    }
  }
}

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

// ===== WORKER-SIDE RENDER =====

function renderGrid(state: { grid: boolean[][]; rows: number; cols: number; generation: number }): VNode {
  const { grid, generation } = state;
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const aliveCount = grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0);

  const children: VNode[] = [];

  // Stats bar
  children.push(
    h('div', 'stats', { className: 'stats-bar' }, [
      t('stats-gen', `Generation: ${generation}`),
      t('stats-alive', ` | Alive: ${aliveCount} / ${rows * cols}`),
    ])
  );

  // Grid container
  const gridChildren: VNode[] = [];
  for (let r = 0; r < rows; r++) {
    const rowChildren: VNode[] = [];
    for (let c = 0; c < cols; c++) {
      const alive = grid[r][c];
      rowChildren.push(
        h('div', `cell-${r}-${c}`, {
          className: alive ? 'cell alive' : 'cell',
          'data-key': `cell-${r}-${c}`,
        }, [t(`cell-${r}-${c}-txt`, alive ? '●' : '')])
      );
    }
    gridChildren.push(h('div', `row-${r}`, { className: 'grid-row' }, rowChildren));
  }

  children.push(h('div', 'grid-root', { className: 'grid-container' }, gridChildren));

  return h('div', 'root', { className: 'worker-dom-root' }, children);
}

function emitPatches(utils: WorkerUtils<any, any, any, any>, patches: Patch[], stats: DomPatchMessage['stats']) {
  utils.outbox.send('main', 'patches', { type: 'patches', patches, stats } as DomPatchMessage);
}

// ===== ACTOR BEHAVIOR =====

interface DomActorState {
  grid: boolean[][];
  rows: number;
  cols: number;
  generation: number;
  prevVDOM: VNode | null;
}

function domActorBehavior(
  msg: any,
  state: DomActorState,
  utils: WorkerUtils<any, any, any, any>
) {
  if (msg.kind !== 'actor-bus') return state;

  let nextState = state;
  let shouldRender = false;

  if (msg.topic === 'init') {
    const payload = msg.payload as { rows: number; cols: number };
    nextState = {
      grid: emptyGrid(payload.rows, payload.cols),
      rows: payload.rows,
      cols: payload.cols,
      generation: 0,
      prevVDOM: null,
    };
    shouldRender = true;
  }

  if (msg.topic === 'click') {
    const key = msg.payload as string;
    nextState = {
      ...nextState,
      grid: toggleCell(nextState.grid, key),
    };
    shouldRender = true;
  }

  if (msg.topic === 'step') {
    nextState = {
      ...nextState,
      grid: conwayStep(nextState.grid),
      generation: nextState.generation + 1,
    };
    shouldRender = true;
  }

  if (msg.topic === 'randomize') {
    const count = (msg.payload as any)?.count ?? 20;
    nextState = {
      ...nextState,
      grid: randomizeGrid(nextState.grid, count),
    };
    shouldRender = true;
  }

  if (msg.topic === 'clear') {
    nextState = {
      ...nextState,
      grid: clearGrid(nextState.grid),
      generation: 0,
    };
    shouldRender = true;
  }

  if (shouldRender) {
    const renderStart = performance.now();
    const nextVDOM = renderGrid(nextState);
    const renderTime = performance.now() - renderStart;

    const diffStart = performance.now();
    const patches: Patch[] = [];
    diffTrees(nextState.prevVDOM, nextVDOM, patches);
    const diffTime = performance.now() - diffStart;

    emitPatches(utils, patches, {
      vdomNodes: countNodes(nextVDOM),
      renderTime: Math.round(renderTime * 100) / 100,
      diffTime: Math.round(diffTime * 100) / 100,
      patchCount: patches.length,
      generation: nextState.generation,
    });

    nextState = { ...nextState, prevVDOM: nextVDOM };
  }

  return nextState;
}

// ===== ACTOR INSTANCE =====

const domActor = actor('dom-renderer', domActorBehavior, {
  grid: [],
  rows: 0,
  cols: 0,
  generation: 0,
  prevVDOM: null,
}, h, t, countNodes, diffProps, diffChildren, sameType, diffTrees, createSubtreePatches, emptyGrid, cloneGrid, conwayStep, toggleCell, randomizeGrid, clearGrid, renderGrid, emitPatches, domActorBehavior);

// ===== ANGULAR SERVICE =====

export type DomStats = DomPatchMessage['stats'];

@Injectable({ providedIn: 'root' })
export class WorkerDomService implements OnDestroy {
  private patchesSubject = createSubject<DomPatchMessage>();
  patches$ = this.patchesSubject;

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

      if (message.topic === 'patches') {
        const payload = message.payload as DomPatchMessage;
        this.patchesSubject.next(payload);
      }
    });
  }

  init(rows: number, cols: number) {
    if (this.destroyed) return;
    main.outbox.send(domActor, 'init', { rows, cols });
    this.gridStateSubject.next({ grid: [], rows, cols, generation: 0 });
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
