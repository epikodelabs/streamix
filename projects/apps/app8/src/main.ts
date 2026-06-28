import { Subscription } from '@epikodelabs/streamix';
import type { AbstractBlock } from 'million';
import { block, mount, patch } from 'million';
import { h } from 'million/jsx-runtime';
import { TerritoryWarsService, TerritoryWarsState } from './territory-wars.service';

// ONLY direct prop reads — no JS conditionals inside.
// The caller computes className, label, and disabled flag.
const Cell = block((props: any) => {
  return h('button', {
    type: 'button',
    class: props.cls,
    'data-row': props.r,
    'data-col': props.c,
    'aria-label': props.label,
    disabled: props.disabled,
  }) as any;
});

function getHoshiSet(size: number): Set<string> {
  const set = new Set<string>();
  const add = (r: number, c: number) => set.add(`${r},${c}`);

  if (size === 9) {
    [2, 6].forEach(p => { add(p, 2); add(p, 6); });
    add(4, 4);
  } else if (size === 11) {
    [2, 8].forEach(p => { add(p, 2); add(p, 8); });
    add(5, 5);
  } else if (size === 13) {
    [3, 9].forEach(p => { add(p, 3); add(p, 9); });
    add(6, 6);
  } else if (size === 19) {
    [3, 9, 15].forEach(r => [3, 9, 15].forEach(c => add(r, c)));
  } else {
    const q = Math.floor((size - 1) / 4);
    const m = Math.floor((size - 1) / 2);
    add(q, q); add(q, size - 1 - q); add(size - 1 - q, q); add(size - 1 - q, size - 1 - q); add(m, m);
  }
  return set;
}

class TerritoryWarsApp {
  private readonly service = new TerritoryWarsService();
  private readonly subscriptions: Subscription[] = [];

  private readonly root: HTMLElement;
  private readonly boardMountEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly scoreUserEl: HTMLElement;
  private readonly scoreRivalEl: HTMLElement;
  private readonly territoryUserEl: HTMLElement;
  private readonly territoryRivalEl: HTMLElement;
  private readonly capturesUserEl: HTMLElement;
  private readonly capturesRivalEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly legalEl: HTMLElement;
  private readonly passButtonEl: HTMLButtonElement;

  private currentSize = 11;
  private cellBlocks: AbstractBlock[][] = [];
  private hoshiSet = new Set<string>();
  private prevState: TerritoryWarsState | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = this.renderShell();

    this.boardMountEl = this.query('[data-role="board-mount"]');
    this.subtitleEl = this.query('[data-role="subtitle"]');
    this.scoreUserEl = this.query('[data-role="score-user"]');
    this.scoreRivalEl = this.query('[data-role="score-rival"]');
    this.territoryUserEl = this.query('[data-role="territory-user"]');
    this.territoryRivalEl = this.query('[data-role="territory-rival"]');
    this.capturesUserEl = this.query('[data-role="captures-user"]');
    this.capturesRivalEl = this.query('[data-role="captures-rival"]');
    this.statusEl = this.query('[data-role="status"]');
    this.legalEl = this.query('[data-role="legal"]');
    this.passButtonEl = this.query('[data-action="pass"]');

    this.bindEvents();
    this.subscriptions.push(
      this.service.state$.subscribe((state) => {
        this.renderState(state);
      })
    );

    this.buildGrid(this.currentSize);
    this.service.start(this.currentSize);
  }

  private renderShell(): string {
    return `
      <div class="tw-shell">
        <header class="hero">
          <div class="hero-copy">
            <p class="eyebrow">streamix Actors + Million.js</p>
            <h1 data-role="headline">Territory Wars</h1>
            <p class="hero-text" data-role="subtitle">
              A native, worker-driven board where your actor challenges a rival actor for control.
            </p>
          </div>
          <div class="rules-card">
            <strong>Rules</strong>
            <p>Place a stone on any empty point. Surrounded groups are captured. Score is stones plus enclosed territory.</p>
          </div>
        </header>

        <section class="toolbar">
          <div class="toolbar-group size-picker">
            <span class="toolbar-label">Board</span>
            <button data-action="size-9">9 × 9</button>
            <button data-action="size-11" class="active">11 × 11</button>
            <button data-action="size-13">13 × 13</button>
          </div>

          <div class="toolbar-group">
            <span class="toolbar-label">Match</span>
            <button data-action="restart">New Match</button>
            <button data-action="pass">Pass Turn</button>
          </div>
        </section>

        <section class="dashboard">
          <article class="score-panel user-panel">
            <span class="panel-label">User Score</span>
            <strong data-role="score-user">0</strong>
            <span class="panel-meta">Territory <b data-role="territory-user">0</b></span>
            <span class="panel-meta">Captures <b data-role="captures-user">0</b></span>
          </article>

          <article class="center-panel">
            <span class="panel-label">Board State</span>
            <strong data-role="status">Starting match…</strong>
            <span class="panel-meta" data-role="legal">Legal moves: user 0, rival 0</span>
          </article>

          <article class="score-panel rival-panel">
            <span class="panel-label">Rival Score</span>
            <strong data-role="score-rival">0</strong>
            <span class="panel-meta">Territory <b data-role="territory-rival">0</b></span>
            <span class="panel-meta">Captures <b data-role="captures-rival">0</b></span>
          </article>
        </section>

        <section class="board-stage">
          <div class="board-frame" data-role="board-frame">
            <div class="board-mount" data-role="board-mount"></div>
          </div>
        </section>

        <section class="notes">
          <p><strong>Actors:</strong> the user actor forwards clicks, the game actor owns rules and scoring, and the rival actor evaluates responses before playing back into the match.</p>
          <p><strong>Main thread:</strong> no Angular templates for the board — only Million.js blocks updating a worker-driven DOM.</p>
        </section>
      </div>
    `;
  }

  private bindEvents(): void {
    this.query<HTMLButtonElement>('[data-action="size-9"]').addEventListener('click', () => {
      this.startMatch(9);
    });
    this.query<HTMLButtonElement>('[data-action="size-11"]').addEventListener('click', () => {
      this.startMatch(11);
    });
    this.query<HTMLButtonElement>('[data-action="size-13"]').addEventListener('click', () => {
      this.startMatch(13);
    });
    this.query<HTMLButtonElement>('[data-action="restart"]').addEventListener('click', () => {
      this.startMatch(this.currentSize);
    });
    this.passButtonEl.addEventListener('click', () => {
      this.service.pass();
    });

    this.boardMountEl.addEventListener('click', (e) => this.onBoardClick(e));
  }

  private startMatch(size: number): void {
    this.currentSize = size;
    this.syncSizeButtons();
    this.cellBlocks = [];
    this.prevState = null;
    this.buildGrid(size);
    this.service.start(size);
  }

  private syncSizeButtons(): void {
    const actions = ['size-9', 'size-11', 'size-13'];
    for (const action of actions) {
      const button = this.query<HTMLButtonElement>(`[data-action="${action}"]`);
      button.classList.toggle('active', action === `size-${this.currentSize}`);
    }
  }

  private renderState(state: TerritoryWarsState): void {
    const winnerLabel =
      state.winner === 'draw'
        ? 'Draw'
        : state.winner === 'user'
          ? 'User leads'
          : state.winner === 'rival'
            ? 'Rival leads'
            : state.currentPlayer === 'user'
              ? 'Your turn'
              : 'Rival turn';

    this.subtitleEl.textContent =
      state.status === 'finished'
        ? `Match finished after ${state.moveCount} turns. ${winnerLabel}.`
        : state.pendingRival
          ? 'Your actor handed the board to the rival actor. The worker is thinking…'
          : 'Place a stone to grow territory, pressure groups, and force captures.';

    this.scoreUserEl.textContent = String(state.score.user);
    this.scoreRivalEl.textContent = String(state.score.rival);
    this.territoryUserEl.textContent = String(Math.max(0, state.score.user - state.stones.user));
    this.territoryRivalEl.textContent = String(Math.max(0, state.score.rival - state.stones.rival));
    this.capturesUserEl.textContent = String(state.captures.user);
    this.capturesRivalEl.textContent = String(state.captures.rival);
    this.statusEl.textContent = state.message;
    this.legalEl.textContent = `Legal moves: user ${state.legalMoves.user}, rival ${state.legalMoves.rival}`;
    this.passButtonEl.disabled = state.status !== 'playing' || state.pendingRival || state.currentPlayer !== 'user';

    this.patchBoard(state);
    this.prevState = state;
  }

  private patchBoard(state: TerritoryWarsState): void {
    const size = state.size;

    if (this.cellBlocks.length !== size) {
      this.buildGrid(size);
    }

    const interactive = state.status === 'playing' && state.currentPlayer === 'user' && !state.pendingRival;
    const prev = this.prevState;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const occupant = state.board[r][c];
        const territory = state.status === 'finished' ? state.territory[r][c] : 0;
        const isLast = state.lastMove?.row === r && state.lastMove?.col === c;
        const isHoshi = this.hoshiSet.has(`${r},${c}`);

        // Skip if nothing changed for this cell
        if (prev &&
            prev.board[r]?.[c] === occupant &&
            (prev.status === 'finished' ? prev.territory[r]?.[c] : 0) === territory &&
            (prev.lastMove?.row === r && prev.lastMove?.col === c) === isLast &&
            (prev.status === 'playing' && prev.currentPlayer === 'user' && !prev.pendingRival) === interactive) {
          continue;
        }

        let cls = 'board-cell';
        if (occupant === 1) cls += ' user';
        else if (occupant === 2) cls += ' rival';

        if (territory === 1 && occupant === 0) cls += ' territory-user';
        else if (territory === 2 && occupant === 0) cls += ' territory-rival';

        if (isLast) cls += ' last-move';
        if (interactive && occupant === 0) cls += ' interactive';
        if (isHoshi && occupant === 0) cls += ' hoshi';

        const oldBlock = this.cellBlocks[r][c];
        const newBlock = Cell({
          cls,
          r: String(r),
          c: String(c),
          label: `Row ${r + 1} column ${c + 1}`,
          disabled: !interactive || occupant !== 0,
        });
        patch(oldBlock, newBlock);
      }
    }
  }

  private buildGrid(size: number): void {
    this.cellBlocks = [];
    this.hoshiSet = getHoshiSet(size);
    this.boardMountEl.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'board-grid';
    grid.style.gridTemplateColumns = `repeat(${size}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${size}, minmax(0, 1fr))`;

    for (let r = 0; r < size; r++) {
      const rowBlocks: AbstractBlock[] = [];
      for (let c = 0; c < size; c++) {
        const isHoshi = this.hoshiSet.has(`${r},${c}`);
        const block = Cell({
          cls: 'board-cell' + (isHoshi ? ' hoshi' : ''),
          r: String(r),
          c: String(c),
          label: `Row ${r + 1} column ${c + 1}`,
          disabled: true,
        });
        mount(block, grid);
        rowBlocks.push(block);
      }
      this.cellBlocks.push(rowBlocks);
    }

    this.boardMountEl.appendChild(grid);
  }

  private onBoardClick(event: MouseEvent): void {
    const btn = (event.target as HTMLElement).closest('button');
    if (!btn) return;

    const row = parseInt(btn.getAttribute('data-row') ?? '', 10);
    const col = parseInt(btn.getAttribute('data-col') ?? '', 10);
    if (Number.isNaN(row) || Number.isNaN(col)) return;

    const state = this.prevState;
    if (!state) return;
    if (state.status !== 'playing' || state.currentPlayer !== 'user' || state.pendingRival) return;
    if (state.board[row][col] !== 0) return;

    this.service.place(row, col);
  }

  async destroy(): Promise<void> {
    for (const subscription of this.subscriptions) {
      subscription();
    }
    this.subscriptions.length = 0;
    await this.service.destroy();
  }

  private query<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing app element: ${selector}`);
    }
    return element;
  }
}

const mountPoint = document.querySelector<HTMLElement>('#app');

if (!mountPoint) {
  throw new Error('Missing #app mount point');
}

const app = new TerritoryWarsApp(mountPoint);
window.addEventListener('beforeunload', () => {
  void app.destroy();
});
