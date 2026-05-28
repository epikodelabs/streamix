import { Subscription } from '@epikodelabs/streamix';
import { block, mount } from 'million';
import type { VElement } from 'million';
import { h } from 'million/jsx-runtime';
import { TerritoryWarsService, TerritoryWarsState } from './territory-wars.service';

type CellVisualProps = {
  row: number;
  col: number;
  occupant: number;
  territory: number;
  last: boolean;
  interactive: boolean;
};

const TerritoryCell = block(((props: CellVisualProps) => {
  let className = 'board-cell';
  if (props.occupant === 1) className += ' user';
  if (props.occupant === 2) className += ' rival';
  if (props.territory === 1 && props.occupant === 0) className += ' territory-user';
  if (props.territory === 2 && props.occupant === 0) className += ' territory-rival';
  if (props.last) className += ' last-move';
  if (props.interactive && props.occupant === 0) className += ' interactive';

  return h('button', {
    type: 'button',
    class: className,
    'data-row': String(props.row),
    'data-col': String(props.col),
    'aria-label': `Row ${props.row + 1} column ${props.col + 1}`,
    'aria-disabled': String(!props.interactive || props.occupant !== 0),
  }) as VElement;
}) as any);

class TerritoryWarsApp {
  private readonly service = new TerritoryWarsService();
  private readonly subscriptions: Subscription[] = [];

  private readonly root: HTMLElement;
  private readonly boardMountEl: HTMLElement;
  private readonly boardFrameEl: HTMLElement;
  private readonly headlineEl: HTMLElement;
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

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = this.renderShell();

    this.boardMountEl = this.query('[data-role="board-mount"]');
    this.boardFrameEl = this.query('[data-role="board-frame"]');
    this.headlineEl = this.query('[data-role="headline"]');
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

    this.renderPlaceholder();
    this.service.start(this.currentSize);
  }

  private renderShell(): string {
    return `
      <div class="tw-shell">
        <header class="hero">
          <div class="hero-copy">
            <p class="eyebrow">Streamix Actors + Million</p>
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
            <button data-action="size-9">9 x 9</button>
            <button data-action="size-11" class="active">11 x 11</button>
            <button data-action="size-13">13 x 13</button>
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
            <strong data-role="status">Starting match...</strong>
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
          <p><strong>Main thread:</strong> no Angular, only native DOM plus Million blocks for the board renderer.</p>
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

  }

  private startMatch(size: number): void {
    this.currentSize = size;
    this.syncSizeButtons();
    this.renderPlaceholder();
    this.service.start(size);
  }

  private syncSizeButtons(): void {
    const actions = ['size-9', 'size-11', 'size-13'];
    for (const action of actions) {
      const button = this.query<HTMLButtonElement>(`[data-action="${action}"]`);
      button.classList.toggle('active', action === `size-${this.currentSize}`);
    }
  }

  private renderPlaceholder(): void {
    this.headlineEl.textContent = 'Territory Wars';
    this.subtitleEl.textContent = 'Loading the actor board and opening the first line...';
    this.scoreUserEl.textContent = '0';
    this.scoreRivalEl.textContent = '0';
    this.territoryUserEl.textContent = '0';
    this.territoryRivalEl.textContent = '0';
    this.capturesUserEl.textContent = '0';
    this.capturesRivalEl.textContent = '0';
    this.statusEl.textContent = 'Starting match...';
    this.legalEl.textContent = 'Legal moves: user 0, rival 0';
    this.passButtonEl.disabled = true;

    const ghost = document.createElement('div');
    ghost.className = 'board-grid ghost-grid';
    ghost.style.setProperty('--size', String(this.currentSize));
    for (let index = 0; index < this.currentSize * this.currentSize; index++) {
      const node = document.createElement('div');
      node.className = 'board-cell ghost';
      ghost.appendChild(node);
    }
    this.boardFrameEl.style.setProperty('--size', String(this.currentSize));
    this.boardMountEl.replaceChildren(ghost);
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
          ? 'Your actor handed the board to the rival actor. The worker is thinking...'
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

    this.renderBoard(state);
  }

  private renderBoard(state: TerritoryWarsState): void {
    const board = document.createElement('div');
    board.className = 'board-grid';
    board.style.setProperty('--size', String(state.size));

    for (let row = 0; row < state.size; row++) {
      for (let col = 0; col < state.size; col++) {
        const last = state.lastMove?.row === row && state.lastMove?.col === col;
        const cell = TerritoryCell({
          row,
          col,
          occupant: state.board[row][col],
          territory: state.status === 'finished' ? state.territory[row][col] : 0,
          last,
          interactive: state.status === 'playing' && state.currentPlayer === 'user' && !state.pendingRival,
        }, `cell-${row}-${col}`);
        mount(cell, board);
      }
    }

    board.addEventListener('click', (event) => {
      if (state.status !== 'playing' || state.currentPlayer !== 'user' || state.pendingRival) {
        return;
      }

      const rect = board.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const cellWidth = rect.width / state.size;
      const cellHeight = rect.height / state.size;
      const col = Math.floor(x / cellWidth);
      const row = Math.floor(y / cellHeight);

      if (row < 0 || row >= state.size || col < 0 || col >= state.size) {
        return;
      }

      if (state.board[row][col] !== 0) {
        return;
      }

      this.service.place(row, col);
    });

    this.boardFrameEl.style.setProperty('--size', String(state.size));
    this.boardMountEl.replaceChildren(board);
  }

  async destroy(): Promise<void> {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
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
