import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from '@epikodelabs/streamix';
import { createBlock, mount, patch, list, withKey, remove, type VNode } from 'blockdom';
import { WorkerDomService } from './worker-dom.service';

// ===== BLOCKDOM BLOCKS =====
// Compiled once. Dynamic parts are filled at render time.

const CellBlock = createBlock(`<div block-attribute-0="class" block-attribute-1="data-key"><block-text-2/></div>`);
const RowBlock = createBlock(`<div class="grid-row"><block-child-0/></div>`);
const GridBlock = createBlock(`
  <div class="worker-dom-root">
    <div class="stats-bar"><block-text-0/></div>
    <div class="grid-container"><block-child-0/></div>
  </div>
`);

@Component({
  selector: 'app-worker-dom',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="experiment">
      <div class="controls">
        <div class="control-group">
          <label>Grid</label>
          <button (click)="initGrid(20, 30)">20×30</button>
          <button (click)="initGrid(30, 40)">30×40</button>
          <button (click)="initGrid(40, 50)">40×50</button>
        </div>

        <div class="control-group">
          <label>Actions</label>
          <button (click)="service.step()">⏭ Step</button>
          <button (click)="service.randomize(40)">🎲 Randomize</button>
          <button (click)="service.clear()">🗑 Clear</button>
        </div>

        <div class="control-group">
          <label>Auto-step</label>
          <button (click)="toggleAuto()" [class.active]="autoRunning">
            {{ autoRunning ? '⏹ Stop' : '▶ Run' }}
          </button>
          <input
            type="range"
            min="50"
            max="1000"
            step="50"
            [value]="autoInterval"
            (input)="setInterval($any($event.target).value)"
          />
          <span class="interval-label">{{ autoInterval }}ms</span>
        </div>
      </div>

      <div class="stats-bar" *ngIf="lastStats">
        <div class="stat">
          <span class="stat-label">Generation</span>
          <span class="stat-value">{{ lastStats.generation }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Cells</span>
          <span class="stat-value">{{ lastStats.nodeCount }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Blockdom Render</span>
          <span class="stat-value">{{ lastStats.renderTime }}ms</span>
        </div>
        <div class="stat activity" [class.busy]="rendering">
          <span class="stat-label">Status</span>
          <span class="stat-value">{{ rendering ? 'rendering' : 'idle' }}</span>
        </div>
      </div>

      <div class="dom-host" (click)="onContainerClick($event)">
        <div #domRoot class="dom-root"></div>
      </div>

      <div class="explanation">
        <p>
          <strong>How it works:</strong> The Game of Life state lives inside a
          Web Worker actor. When you click a cell, press Step, or toggle Auto-run,
          a message goes to the worker. The worker updates state and sends the raw
          grid back to the main thread.
        </p>
        <p>
          The main thread uses <strong>Blockdom</strong> — a fast block-based virtual DOM
          library — to render the grid. Blockdom compiles the grid template once,
          then efficiently patches only the dynamic parts (cell classes and text)
          on every state update.
        </p>
      </div>
    </div>
  `,
  styles: [`
    .experiment {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      justify-content: center;
    }

    .control-group {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 10px;
      padding: 10px 14px;
    }

    .control-group label {
      font-size: 0.75rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      width: 100%;
      margin-bottom: 2px;
    }

    .control-group button {
      padding: 6px 12px;
      border: none;
      border-radius: 6px;
      background: #2d2d44;
      color: #eee;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.15s;
    }

    .control-group button:hover {
      background: #3d3d5c;
    }

    .control-group button.active {
      background: #00d4aa;
      color: #1a1a2e;
      font-weight: bold;
    }

    .interval-label {
      font-size: 0.8rem;
      color: #aaa;
      min-width: 42px;
    }

    input[type="range"] {
      width: 100px;
    }

    .stats-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: center;
      background: #0a0a14;
      border: 1px solid #1a1a2e;
      border-radius: 10px;
      padding: 12px 16px;
    }

    .stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 64px;
    }

    .stat-label {
      font-size: 0.65rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .stat-value {
      font-size: 1.1rem;
      font-weight: bold;
      color: #00d4aa;
    }

    .activity .stat-value {
      color: #888;
    }

    .activity.busy .stat-value {
      color: #e67e22;
    }

    .dom-host {
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 200px;
      background: #0a0a14;
      border: 1px solid #1a1a2e;
      border-radius: 12px;
      padding: 20px;
      overflow: auto;
    }

    .dom-root {
      line-height: 1;
    }

    .explanation {
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 10px;
      padding: 14px 18px;
      font-size: 0.85rem;
      line-height: 1.6;
      color: #ccc;
    }

    .explanation strong {
      color: #eee;
    }

    /* Deep styles for Blockdom-rendered DOM */
    ::ng-deep .worker-dom-root {
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: center;
    }

    ::ng-deep .stats-bar {
      font-size: 0.9rem;
      color: #00d4aa;
      margin-bottom: 8px;
    }

    ::ng-deep .grid-container {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: #0f3460;
      padding: 2px;
      border-radius: 4px;
    }

    ::ng-deep .grid-row {
      display: flex;
      gap: 1px;
    }

    ::ng-deep .cell {
      width: 16px;
      height: 16px;
      background: #1a1a2e;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      color: #00d4aa;
      cursor: pointer;
      user-select: none;
      transition: background 0.05s;
    }

    ::ng-deep .cell:hover {
      background: #2d2d44;
    }

    ::ng-deep .cell.alive {
      background: #00d4aa;
      color: #1a1a2e;
    }

    ::ng-deep .cell.alive:hover {
      background: #00f0c0;
    }
  `],
})
export class WorkerDomComponent implements OnInit, OnDestroy {
  @ViewChild('domRoot', { static: true }) domRootRef!: ElementRef<HTMLDivElement>;

  lastStats: { generation: number; renderTime: number; nodeCount: number } | null = null;
  rendering = false;
  autoRunning = false;
  autoInterval = 200;

  private subs: Subscription[] = [];
  private currentTree: VNode | null = null;
  private autoTimer: ReturnType<typeof setInterval> | null = null;

  constructor(public service: WorkerDomService) {}

  ngOnInit() {
    this.subs.push(
      this.service.state$.subscribe((msg) => {
        this.renderGrid(msg.grid, msg.generation);
      })
    );

    this.initGrid(20, 30);
  }

  ngOnDestroy() {
    this.stopAuto();
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
    this.subs = [];
    if (this.currentTree) {
      remove(this.currentTree);
      this.currentTree = null;
    }
    this.service.ngOnDestroy();
  }

  initGrid(rows: number, cols: number) {
    this.stopAuto();
    if (this.currentTree) {
      remove(this.currentTree);
      this.currentTree = null;
    }
    this.service.init(rows, cols);
  }

  toggleAuto() {
    if (this.autoRunning) {
      this.stopAuto();
    } else {
      this.startAuto();
    }
  }

  setInterval(val: number) {
    this.autoInterval = val;
    if (this.autoRunning) {
      this.stopAuto();
      this.startAuto();
    }
  }

  private startAuto() {
    this.autoRunning = true;
    this.autoTimer = setInterval(() => {
      this.service.step();
    }, this.autoInterval);
  }

  private stopAuto() {
    this.autoRunning = false;
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  onContainerClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const key = target.getAttribute('data-key');
    if (key) {
      this.service.click(key);
    }
  }

  private renderGrid(grid: boolean[][], generation: number) {
    const start = performance.now();
    this.rendering = true;

    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;
    const aliveCount = grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0);

    // Build cell blocks with keys
    const cellBlocks: VNode[][] = [];
    for (let r = 0; r < rows; r++) {
      const rowCells: VNode[] = [];
      for (let c = 0; c < cols; c++) {
        const alive = grid[r][c];
        const block = CellBlock([
          alive ? 'cell alive' : 'cell',
          `cell-${r}-${c}`,
          alive ? '●' : '',
        ]);
        rowCells.push(withKey(block, `cell-${r}-${c}`));
      }
      cellBlocks.push(rowCells);
    }

    // Build row blocks with keyed cell lists
    const rowBlocks: VNode[] = [];
    for (let r = 0; r < rows; r++) {
      const block = RowBlock([], [list(cellBlocks[r])]);
      rowBlocks.push(withKey(block, `row-${r}`));
    }

    // Build grid tree
    const tree = GridBlock(
      [`Generation: ${generation} | Alive: ${aliveCount} / ${rows * cols}`],
      [list(rowBlocks)]
    );

    if (this.currentTree) {
      patch(this.currentTree, tree);
    } else {
      mount(tree, this.domRootRef.nativeElement);
      this.currentTree = tree;
    }

    const renderTime = performance.now() - start;
    this.lastStats = {
      generation,
      renderTime: Math.round(renderTime * 100) / 100,
      nodeCount: rows * cols,
    };
    this.rendering = false;
  }
}
