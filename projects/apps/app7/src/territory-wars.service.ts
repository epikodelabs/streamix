import { createSubject } from '@epikodelabs/streamix';
import { actor, ActorBusMessage, main, WorkerUtils } from '@epikodelabs/streamix/coroutines';

export type PlayerId = 'user' | 'rival';

export type TerritoryWarsState = {
  board: number[][];
  territory: number[][];
  size: number;
  currentPlayer: PlayerId;
  pendingRival: boolean;
  status: 'playing' | 'finished';
  moveCount: number;
  passStreak: number;
  captures: Record<PlayerId, number>;
  stones: Record<PlayerId, number>;
  score: Record<PlayerId, number>;
  legalMoves: Record<PlayerId, number>;
  winner: PlayerId | 'draw' | null;
  message: string;
  lastMove: { row: number; col: number; player: PlayerId } | null;
};

type MovePayload = {
  row: number;
  col: number;
};

type RivalThinkPayload = {
  board: number[][];
  size: number;
  turnId: number;
};

type RivalMovePayload = {
  turnId: number;
  move: MovePayload | null;
};

type InternalGameState = {
  board: number[][];
  size: number;
  currentPlayer: PlayerId;
  pendingRival: boolean;
  status: 'playing' | 'finished';
  moveCount: number;
  passStreak: number;
  captures: Record<PlayerId, number>;
  winner: PlayerId | 'draw' | null;
  message: string;
  lastMove: { row: number; col: number; player: PlayerId } | null;
  turnId: number;
};

type PlacementResult =
  | {
      ok: true;
      board: number[][];
      captured: number;
    }
  | {
      ok: false;
      board: number[][];
      reason: string;
    };

function createBoard(size: number): number[][] {
  const board: number[][] = [];
  for (let row = 0; row < size; row++) {
    const line: number[] = [];
    for (let col = 0; col < size; col++) {
      line.push(0);
    }
    board.push(line);
  }
  return board;
}

function cloneBoard(board: number[][]): number[][] {
  return board.map((row) => row.slice());
}

function createInternalState(size: number): InternalGameState {
  return {
    board: createBoard(size),
    size,
    currentPlayer: 'user',
    pendingRival: false,
    status: 'playing',
    moveCount: 0,
    passStreak: 0,
    captures: {
      user: 0,
      rival: 0,
    },
    winner: null,
    message: 'Your move. Surround rival groups to capture them.',
    lastMove: null,
    turnId: 0,
  };
}

function playerToStone(player: PlayerId): number {
  return player === 'user' ? 1 : 2;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 'user' ? 'rival' : 'user';
}

function inBounds(size: number, row: number, col: number): boolean {
  return row >= 0 && row < size && col >= 0 && col < size;
}

function neighbors(size: number, row: number, col: number): [number, number][] {
  const result: [number, number][] = [];
  if (row > 0) result.push([row - 1, col]);
  if (row + 1 < size) result.push([row + 1, col]);
  if (col > 0) result.push([row, col - 1]);
  if (col + 1 < size) result.push([row, col + 1]);
  return result;
}

function groupKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function collectGroup(board: number[][], row: number, col: number): {
  cells: [number, number][];
  liberties: number;
} {
  const size = board.length;
  const stone = board[row][col];
  const stack: [number, number][] = [[row, col]];
  const seen = new Set<string>([groupKey(row, col)]);
  const liberties = new Set<string>();
  const cells: [number, number][] = [];

  while (stack.length > 0) {
    const [currentRow, currentCol] = stack.pop()!;
    cells.push([currentRow, currentCol]);

    for (const [nextRow, nextCol] of neighbors(size, currentRow, currentCol)) {
      const value = board[nextRow][nextCol];
      if (value === 0) {
        liberties.add(groupKey(nextRow, nextCol));
        continue;
      }
      if (value !== stone) {
        continue;
      }
      const key = groupKey(nextRow, nextCol);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      stack.push([nextRow, nextCol]);
    }
  }

  return {
    cells,
    liberties: liberties.size,
  };
}

function removeGroup(board: number[][], cells: [number, number][]): void {
  for (const [row, col] of cells) {
    board[row][col] = 0;
  }
}

function tryPlaceStone(board: number[][], row: number, col: number, player: PlayerId): PlacementResult {
  const size = board.length;
  if (!inBounds(size, row, col)) {
    return { ok: false, board, reason: 'That point is outside the board.' };
  }
  if (board[row][col] !== 0) {
    return { ok: false, board, reason: 'That point is already occupied.' };
  }

  const nextBoard = cloneBoard(board);
  const ownStone = playerToStone(player);
  const enemyStone = playerToStone(otherPlayer(player));
  nextBoard[row][col] = ownStone;

  let captured = 0;
  const seenEnemyGroups = new Set<string>();

  for (const [neighborRow, neighborCol] of neighbors(size, row, col)) {
    if (nextBoard[neighborRow][neighborCol] !== enemyStone) {
      continue;
    }

    const key = groupKey(neighborRow, neighborCol);
    if (seenEnemyGroups.has(key)) {
      continue;
    }

    const enemyGroup = collectGroup(nextBoard, neighborRow, neighborCol);
    for (const [groupRow, groupCol] of enemyGroup.cells) {
      seenEnemyGroups.add(groupKey(groupRow, groupCol));
    }

    if (enemyGroup.liberties === 0) {
      captured += enemyGroup.cells.length;
      removeGroup(nextBoard, enemyGroup.cells);
    }
  }

  const ownGroup = collectGroup(nextBoard, row, col);
  if (ownGroup.liberties === 0) {
    return {
      ok: false,
      board,
      reason: captured > 0 ? 'Illegal move.' : 'Suicidal moves are not allowed.',
    };
  }

  return {
    ok: true,
    board: nextBoard,
    captured,
  };
}

function countStones(board: number[][]): Record<PlayerId, number> {
  let user = 0;
  let rival = 0;

  for (const row of board) {
    for (const cell of row) {
      if (cell === 1) user++;
      if (cell === 2) rival++;
    }
  }

  return { user, rival };
}

function computeTerritory(board: number[][]): number[][] {
  const size = board.length;
  const territory = createBoard(size);
  const open = new Set<string>(); // empty cells reachable from the board edge

  // Flood-fill from all empty cells on the border
  const stack: [number, number][] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === 0 && (r === 0 || r === size - 1 || c === 0 || c === size - 1)) {
        const key = groupKey(r, c);
        if (!open.has(key)) {
          open.add(key);
          stack.push([r, c]);
        }
      }
    }
  }

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    for (const [nr, nc] of neighbors(size, r, c)) {
      if (board[nr][nc] === 0) {
        const key = groupKey(nr, nc);
        if (!open.has(key)) {
          open.add(key);
          stack.push([nr, nc]);
        }
      }
    }
  }

  // Any empty cell not in 'open' is enclosed — determine its owner
  const seen = new Set<string>();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] !== 0 || open.has(groupKey(r, c)) || seen.has(groupKey(r, c))) {
        continue;
      }

      const region: [number, number][] = [];
      const borderOwners = new Set<number>();
      const regionStack: [number, number][] = [[r, c]];
      seen.add(groupKey(r, c));

      while (regionStack.length > 0) {
        const [cr, cc] = regionStack.pop()!;
        region.push([cr, cc]);

        for (const [nr, nc] of neighbors(size, cr, cc)) {
          if (board[nr][nc] === 0) {
            const key = groupKey(nr, nc);
            if (!seen.has(key)) {
              seen.add(key);
              regionStack.push([nr, nc]);
            }
          } else {
            borderOwners.add(board[nr][nc]);
          }
        }
      }

      if (borderOwners.size === 1) {
        const owner = [...borderOwners][0];
        for (const [tr, tc] of region) {
          territory[tr][tc] = owner;
        }
      }
    }
  }

  return territory;
}

function countTerritory(territory: number[][]): Record<PlayerId, number> {
  let user = 0;
  let rival = 0;

  for (const row of territory) {
    for (const cell of row) {
      if (cell === 1) user++;
      if (cell === 2) rival++;
    }
  }

  return { user, rival };
}

function countLegalMoves(board: number[][], player: PlayerId): number {
  let total = 0;
  const size = board.length;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (board[row][col] !== 0) {
        continue;
      }
      if (tryPlaceStone(board, row, col, player).ok) {
        total++;
      }
    }
  }

  return total;
}

function scoreBoard(board: number[][], captures: Record<PlayerId, number>) {
  const stones = countStones(board);
  const territory = computeTerritory(board);
  const territoryCount = countTerritory(territory);

  return {
    stones,
    territory,
    score: {
      user: stones.user + territoryCount.user,
      rival: stones.rival + territoryCount.rival,
    },
    legalMoves: {
      user: countLegalMoves(board, 'user'),
      rival: countLegalMoves(board, 'rival'),
    },
    captures: {
      user: captures.user,
      rival: captures.rival,
    },
  };
}

function determineWinner(
  score: Record<PlayerId, number>,
  captures: Record<PlayerId, number>
): PlayerId | 'draw' {
  if (score.user !== score.rival) {
    return score.user > score.rival ? 'user' : 'rival';
  }
  if (captures.user !== captures.rival) {
    return captures.user > captures.rival ? 'user' : 'rival';
  }
  return 'draw';
}

function createPublicState(state: InternalGameState): TerritoryWarsState {
  const scored = scoreBoard(state.board, state.captures);

  return {
    board: state.board,
    territory: scored.territory,
    size: state.size,
    currentPlayer: state.currentPlayer,
    pendingRival: state.pendingRival,
    status: state.status,
    moveCount: state.moveCount,
    passStreak: state.passStreak,
    captures: scored.captures,
    stones: scored.stones,
    score: scored.score,
    legalMoves: scored.legalMoves,
    winner: state.winner,
    message: state.message,
    lastMove: state.lastMove,
  };
}

function emitState(
  utils: WorkerUtils<any, any, any, any>,
  state: InternalGameState
): void {
  utils.outbox.send('main', 'state', createPublicState(state));
}

function finishGame(state: InternalGameState, message: string): InternalGameState {
  const scored = scoreBoard(state.board, state.captures);
  return {
    ...state,
    pendingRival: false,
    status: 'finished',
    currentPlayer: 'user',
    winner: determineWinner(scored.score, state.captures),
    message,
  };
}

function maybeFinishGame(state: InternalGameState): InternalGameState {
  const scored = scoreBoard(state.board, state.captures);
  const boardFilled = scored.stones.user + scored.stones.rival === state.size * state.size;

  if (state.passStreak >= 2) {
    return finishGame(state, 'Both players passed. Final territory counted.');
  }

  if (boardFilled) {
    return finishGame(state, 'The board is full. Final territory counted.');
  }

  if (scored.legalMoves.user === 0 && scored.legalMoves.rival === 0) {
    return finishGame(state, 'No legal moves remain. Final territory counted.');
  }

  return state;
}

function scheduleRival(
  utils: WorkerUtils<any, any, any, any>,
  state: InternalGameState
): void {
  utils.outbox.send('territory-rival', 'think', {
    board: cloneBoard(state.board),
    size: state.size,
    turnId: state.turnId,
  } as RivalThinkPayload);
}

function libertiesAfterMove(board: number[][], row: number, col: number): number {
  return collectGroup(board, row, col).liberties;
}

function scoreMove(board: number[][], row: number, col: number, player: PlayerId): number {
  const attempt = tryPlaceStone(board, row, col, player);
  if (!attempt.ok) {
    return Number.NEGATIVE_INFINITY;
  }

  const size = board.length;
  const center = (size - 1) / 2;
  const distance = Math.abs(row - center) + Math.abs(col - center);
  let friendlyEdges = 0;
  let enemyEdges = 0;
  const friendlyStone = playerToStone(player);
  const enemyStone = playerToStone(otherPlayer(player));

  for (const [neighborRow, neighborCol] of neighbors(size, row, col)) {
    const value = board[neighborRow][neighborCol];
    if (value === friendlyStone) friendlyEdges++;
    if (value === enemyStone) enemyEdges++;
  }

  const followUpLiberties = libertiesAfterMove(attempt.board, row, col);

  return (
    attempt.captured * 120 +
    friendlyEdges * 11 +
    enemyEdges * 9 +
    followUpLiberties * 7 -
    distance * 1.4 +
    Math.random() * 3
  );
}

function chooseRivalMove(board: number[][]): MovePayload | null {
  const size = board.length;
  let bestMove: MovePayload | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (board[row][col] !== 0) {
        continue;
      }

      const score = scoreMove(board, row, col, 'rival');
      if (score > bestScore) {
        bestScore = score;
        bestMove = { row, col };
      }
    }
  }

  return Number.isFinite(bestScore) ? bestMove : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function userActorBehavior(
  msg: unknown,
  state: { forwarded: number },
  utils: WorkerUtils<any, any, any, any>
): Promise<{ forwarded: number }> {
  if (typeof msg !== 'object' || msg === null || (msg as ActorBusMessage<any>).kind !== 'actor-bus') {
    return state;
  }

  const message = msg as ActorBusMessage<any>;
  if (message.topic === 'place') {
    utils.outbox.send('territory-game', 'user-place', message.payload as MovePayload);
    return { forwarded: state.forwarded + 1 };
  }

  if (message.topic === 'pass') {
    utils.outbox.send('territory-game', 'user-pass', null);
    return { forwarded: state.forwarded + 1 };
  }

  return state;
}

async function rivalActorBehavior(
  msg: unknown,
  state: { decisions: number },
  utils: WorkerUtils<any, any, any, any>
): Promise<{ decisions: number }> {
  if (typeof msg !== 'object' || msg === null || (msg as ActorBusMessage<any>).kind !== 'actor-bus') {
    return state;
  }

  const message = msg as ActorBusMessage<any>;
  if (message.topic !== 'think') {
    return state;
  }

  const payload = message.payload as RivalThinkPayload;
  await sleep(220 + Math.floor(Math.random() * 260));
  const move = chooseRivalMove(payload.board);

  utils.outbox.send('territory-game', 'rival-response', {
    turnId: payload.turnId,
    move,
  } as RivalMovePayload);

  return {
    decisions: state.decisions + 1,
  };
}

async function gameActorBehavior(
  msg: unknown,
  state: InternalGameState,
  utils: WorkerUtils<any, any, any, any>
): Promise<InternalGameState> {
  if (typeof msg !== 'object' || msg === null || (msg as ActorBusMessage<any>).kind !== 'actor-bus') {
    return state;
  }

  const message = msg as ActorBusMessage<any>;

  if (message.topic === 'init') {
    const requestedSize = Number((message.payload as { size?: number } | null)?.size ?? 11);
    const size = requestedSize >= 7 && requestedSize <= 19 ? requestedSize : 11;
    const nextState = createInternalState(size);
    emitState(utils, nextState);
    return nextState;
  }

  if (state.status !== 'playing') {
    emitState(utils, state);
    return state;
  }

  if (message.topic === 'user-place') {
    if (state.currentPlayer !== 'user' || state.pendingRival) {
      return state;
    }

    const payload = message.payload as MovePayload;
    const placed = tryPlaceStone(state.board, payload.row, payload.col, 'user');
    if (!placed.ok) {
      const nextState = {
        ...state,
        message: placed.reason,
      };
      emitState(utils, nextState);
      return nextState;
    }

    let nextState: InternalGameState = {
      ...state,
      board: placed.board,
      currentPlayer: 'rival',
      pendingRival: true,
      moveCount: state.moveCount + 1,
      passStreak: 0,
      captures: {
        ...state.captures,
        user: state.captures.user + placed.captured,
      },
      message: placed.captured > 0 ? `You captured ${placed.captured} rival stone${placed.captured === 1 ? '' : 's'}.` : 'Rival is reading the board...',
      lastMove: {
        row: payload.row,
        col: payload.col,
        player: 'user',
      },
      turnId: state.turnId + 1,
    };

    nextState = maybeFinishGame(nextState);
    emitState(utils, nextState);
    if (nextState.status === 'playing') {
      scheduleRival(utils, nextState);
    }
    return nextState;
  }

  if (message.topic === 'user-pass') {
    if (state.currentPlayer !== 'user' || state.pendingRival) {
      return state;
    }

    let nextState: InternalGameState = {
      ...state,
      currentPlayer: 'rival',
      pendingRival: true,
      moveCount: state.moveCount + 1,
      passStreak: state.passStreak + 1,
      message: 'You passed. Rival is deciding whether to invade or pass back.',
      lastMove: null,
      turnId: state.turnId + 1,
    };

    nextState = maybeFinishGame(nextState);
    emitState(utils, nextState);
    if (nextState.status === 'playing') {
      scheduleRival(utils, nextState);
    }
    return nextState;
  }

  if (message.topic === 'rival-response') {
    const payload = message.payload as RivalMovePayload;
    if (!state.pendingRival || state.currentPlayer !== 'rival' || payload.turnId !== state.turnId) {
      return state;
    }

    if (!payload.move) {
      let nextState: InternalGameState = {
        ...state,
        currentPlayer: 'user',
        pendingRival: false,
        moveCount: state.moveCount + 1,
        passStreak: state.passStreak + 1,
        message: 'Rival passed. Your move.',
        lastMove: null,
      };

      nextState = maybeFinishGame(nextState);
      emitState(utils, nextState);
      return nextState;
    }

    const placed = tryPlaceStone(state.board, payload.move.row, payload.move.col, 'rival');
    if (!placed.ok) {
      let nextState: InternalGameState = {
        ...state,
        currentPlayer: 'user',
        pendingRival: false,
        moveCount: state.moveCount + 1,
        passStreak: state.passStreak + 1,
        message: 'Rival abandoned the line and passed. Your move.',
        lastMove: null,
      };

      nextState = maybeFinishGame(nextState);
      emitState(utils, nextState);
      return nextState;
    }

    let nextState: InternalGameState = {
      ...state,
      board: placed.board,
      currentPlayer: 'user',
      pendingRival: false,
      moveCount: state.moveCount + 1,
      passStreak: 0,
      captures: {
        ...state.captures,
        rival: state.captures.rival + placed.captured,
      },
      message: placed.captured > 0 ? `Rival captured ${placed.captured} of your stones.` : 'Your move.',
      lastMove: {
        row: payload.move.row,
        col: payload.move.col,
        player: 'rival',
      },
    };

    nextState = maybeFinishGame(nextState);
    emitState(utils, nextState);
    return nextState;
  }

  return state;
}

const userActor = actor(
  'territory-user',
  userActorBehavior,
  { forwarded: 0 }
);

const rivalActor = actor(
  'territory-rival',
  rivalActorBehavior,
  { decisions: 0 },
  sleep,
  chooseRivalMove,
  scoreMove,
  tryPlaceStone,
  libertiesAfterMove,
  collectGroup,
  groupKey,
  cloneBoard,
  neighbors,
  playerToStone,
  otherPlayer,
  inBounds,
  removeGroup
);

const gameActor = actor(
  'territory-game',
  gameActorBehavior,
  createInternalState(11),
  createBoard,
  cloneBoard,
  createInternalState,
  playerToStone,
  otherPlayer,
  inBounds,
  neighbors,
  groupKey,
  collectGroup,
  removeGroup,
  tryPlaceStone,
  countStones,
  computeTerritory,
  countTerritory,
  countLegalMoves,
  scoreBoard,
  determineWinner,
  createPublicState,
  emitState,
  finishGame,
  maybeFinishGame,
  scheduleRival
);

export class TerritoryWarsService {
  private readonly stateSubject = createSubject<TerritoryWarsState>();
  readonly state$ = this.stateSubject;

  private readonly unsubscribeInbox: () => void;
  private destroyed = false;

  constructor() {
    this.unsubscribeInbox = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.from !== 'territory-game' || message.topic !== 'state') {
        return;
      }
      this.stateSubject.next(message.payload as TerritoryWarsState);
    });
  }

  start(size: number): void {
    if (this.destroyed) {
      return;
    }
    main.outbox.send(gameActor, 'init', { size });
  }

  place(row: number, col: number): void {
    if (this.destroyed) {
      return;
    }
    main.outbox.send(userActor, 'place', { row, col });
  }

  pass(): void {
    if (this.destroyed) {
      return;
    }
    main.outbox.send(userActor, 'pass', null);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.unsubscribeInbox();
    await Promise.all([
      main.outbox.stop(userActor),
      main.outbox.stop(rivalActor),
      main.outbox.stop(gameActor),
    ]);
  }
}
