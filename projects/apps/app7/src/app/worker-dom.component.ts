import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from '@epikodelabs/streamix';
import { Patch, WorkerDomService } from './worker-dom.service';

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
          <span class="stat-label">VDOM Nodes</span>
          <span class="stat-value">{{ lastStats.vdomNodes }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Render</span>
          <span class="stat-value">{{ lastStats.renderTime }}ms</span>
        </div>
        <div class="stat">
          <span class="stat-label">Diff</span>
          <span class="stat-value">{{ lastStats.diffTime }}ms</span>
        </div>
        <div class="stat">
          <span class="stat-label">Patches</span>
          <span class="stat-value">{{ lastStats.patchCount }}</span>
        </div>
        <div class="stat activity" [class.busy]="patching">
          <span class="stat-label">Status</span>
          <span class="stat-value">{{ patching ? 'patching' : 'idle' }}</span>
        </div>
      </div>

      <div class="dom-host" (click)="onContainerClick($event)">
        <div #domRoot class="dom-root"></div>
      </div>

      <div class="explanation">
        <p>
          <strong>How it works:</strong> The entire grid state and virtual DOM live inside a
          Web Worker actor. When you click a cell, press Step, or toggle Auto-run, a message
          goes to the worker. The worker updates state, renders a new VDOM, diffs it against
          the previous tree, and sends only the <em>patches</em> back to the main thread.
          The component above applies those patches to the real DOM container—no full re-render,
          no Angular change detection for the grid itself.
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

    .explanation em {
      color: #ffd700;
      font-style: normal;
    }

    /* Deep styles for worker-rendered DOM */
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

  lastStats: { generation: number; vdomNodes: number; renderTime: number; diffTime: number; patchCount: number } | null = null;
  patching = false;
  autoRunning = false;
  autoInterval = 200;

  private subs: Subscription[] = [];
  private nodeMap = new Map<string, Node>();
  private autoTimer: ReturnType<typeof setInterval> | null = null;

  constructor(public service: WorkerDomService) {}

  ngOnInit() {
    this.subs.push(
      this.service.patches$.subscribe((msg) => {
        this.lastStats = msg.stats;
        this.patching = true;
        // Use requestAnimationFrame to batch patch application to the next frame
        requestAnimationFrame(() => {
          this.applyPatches(msg.patches);
          this.patching = false;
        });
      })
    );

    // Default grid
    this.initGrid(20, 30);
  }

  ngOnDestroy() {
    this.stopAuto();
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
    this.subs = [];
    this.service.ngOnDestroy();
  }

  initGrid(rows: number, cols: number) {
    this.stopAuto();
    this.clearDOM();
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

  private clearDOM() {
    const root = this.domRootRef.nativeElement;
    root.innerHTML = '';
    this.nodeMap.clear();
  }

  private applyPatches(patches: Patch[]) {
    const root = this.domRootRef.nativeElement;

    for (const patch of patches) {
      try {
        switch (patch.op) {
          case 'createElement': {
            const el = document.createElement(patch.tag);
            this.applyProps(el, patch.props);
            this.insertNode(el, patch.parentKey, patch.index, root);
            this.nodeMap.set(patch.key, el);
            break;
          }
          case 'createText': {
            const text = document.createTextNode(patch.content);
            this.insertNode(text, patch.parentKey, patch.index, root);
            this.nodeMap.set(patch.key, text);
            break;
          }
          case 'remove': {
            const node = this.nodeMap.get(patch.key);
            if (node && node.parentNode) {
              node.parentNode.removeChild(node);
            }
            this.nodeMap.delete(patch.key);
            break;
          }
          case 'setText': {
            const textNode = this.nodeMap.get(patch.key);
            if (textNode) {
              textNode.textContent = patch.content;
            }
            break;
          }
          case 'setProp': {
            const el = this.nodeMap.get(patch.key) as HTMLElement | undefined;
            if (el && el.nodeType === Node.ELEMENT_NODE) {
              this.setProp(el, patch.name, patch.value);
            }
            break;
          }
          case 'removeProp': {
            const el2 = this.nodeMap.get(patch.key) as HTMLElement | undefined;
            if (el2 && el2.nodeType === Node.ELEMENT_NODE) {
              this.removeProp(el2, patch.name);
            }
            break;
          }
          case 'move': {
            const moving = this.nodeMap.get(patch.key);
            if (moving) {
              this.insertNode(moving, patch.parentKey, patch.index, root);
            }
            break;
          }
        }
      } catch (err) {
        console.warn('Patch failed:', patch, err);
      }
    }
  }

  private insertNode(node: Node, parentKey: string | null, index: number, fallbackRoot: HTMLElement) {
    const parent = parentKey ? (this.nodeMap.get(parentKey) as HTMLElement | undefined) : fallbackRoot;
    if (!parent) return;

    if (index >= parent.childNodes.length) {
      parent.appendChild(node);
    } else {
      parent.insertBefore(node, parent.childNodes[index]);
    }
  }

  private applyProps(el: HTMLElement, props: Record<string, any>) {
    for (const [name, value] of Object.entries(props)) {
      this.setProp(el, name, value);
    }
  }

  private setProp(el: HTMLElement, name: string, value: any) {
    if (name === 'className') {
      el.className = String(value);
    } else if (name === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (name.startsWith('data-')) {
      el.setAttribute(name, String(value));
    } else if (name in el && name !== 'list' && name !== 'form' && name !== 'type') {
      (el as any)[name] = value;
    } else {
      el.setAttribute(name, String(value));
    }
  }

  private removeProp(el: HTMLElement, name: string) {
    if (name === 'className') {
      el.className = '';
    } else if (name === 'style') {
      el.removeAttribute('style');
    } else if (name.startsWith('data-')) {
      el.removeAttribute(name);
    } else if (name in el) {
      (el as any)[name] = '';
    } else {
      el.removeAttribute(name);
    }
  }
}
