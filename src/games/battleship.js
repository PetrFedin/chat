/**
 * Battleship, with the fleet and the neighbour rule the Russian game uses.
 *
 * The part that has to be server-side is not the shooting, it is the fleet:
 * a client that keeps its own ships can move one out from under a shot. The
 * server holds both boards, and each side is told only what it has earned —
 * its own fleet in full, and of the opponent's only the squares it has fired
 * at. Nothing else is ever sent.
 *
 * A board is 100 squares, index 0 = a1, row-major, 10×10.
 */

export const SIZE = 10;
// One four, two threes, three twos, four ones — the standard fleet.
export const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

export const initialState = () => ({
  phase: 'placing',
  // Per player: { ships: [[index,...]], shots: {index: 'hit'|'miss'} }
  boards: {},
  turn: null,
  ready: [],
});

const coordinates = (index) => [index % SIZE, Math.floor(index / SIZE)];
const indexOf = (x, y) => y * SIZE + x;
const inside = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;

export const squareName = (index) => {
  const [x, y] = coordinates(index);
  return `${'абвгдежзик'[x]}${y + 1}`;
};

/** Squares touching a ship, diagonals included. Ships may not share them. */
function halo(cells) {
  const out = new Set();
  for (const cell of cells) {
    const [x, y] = coordinates(cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (inside(nx, ny)) out.add(indexOf(nx, ny));
      }
    }
  }
  return out;
}

/**
 * A fleet is valid when it is the right ships, each one straight and
 * unbroken, and no two of them touching — the rule that stops a player
 * packing ten ships into a corner where they cannot be found.
 */
export function validateFleet(ships) {
  if (!Array.isArray(ships)) throw fail('A fleet is a list of ships', 'INVALID_FLEET');
  const sizes = ships.map((s) => (Array.isArray(s) ? s.length : 0)).sort((a, b) => b - a);
  const wanted = [...FLEET].sort((a, b) => b - a);
  if (sizes.length !== wanted.length || sizes.some((n, i) => n !== wanted[i])) {
    throw fail(`The fleet must be ${FLEET.join(', ')}`, 'INVALID_FLEET');
  }

  const taken = new Set();
  for (const ship of ships) {
    const cells = ship.map(Number);
    if (cells.some((c) => !Number.isInteger(c) || c < 0 || c >= SIZE * SIZE)) throw fail('A ship is off the board', 'INVALID_FLEET');
    if (new Set(cells).size !== cells.length) throw fail('A ship repeats a square', 'INVALID_FLEET');

    const xs = new Set(cells.map((c) => coordinates(c)[0]));
    const ys = new Set(cells.map((c) => coordinates(c)[1]));
    if (xs.size !== 1 && ys.size !== 1) throw fail('A ship must be straight', 'INVALID_FLEET');
    const line = [...cells].sort((a, b) => a - b);
    const step = xs.size === 1 ? SIZE : 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] - line[i - 1] !== step) throw fail('A ship must be unbroken', 'INVALID_FLEET');
    }

    // `taken` already holds the earlier ships and the ring around them, so a
    // ship is legal exactly when none of its own squares is in there. Testing
    // its halo instead rejected two ships a clear square apart, because their
    // rings meet in the gap — which is allowed.
    for (const cell of cells) {
      if (taken.has(cell)) throw fail('Ships may not overlap or touch', 'INVALID_FLEET');
    }
    for (const cell of halo(cells)) taken.add(cell);
  }
  return ships.map((ship) => ship.map(Number));
}

// Shooting out of turn is a conflict, not a malformed request; the helper
// was dropping the status its callers passed and answering 400 for both.
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

export function place(state, player, ships) {
  if (state.phase !== 'placing') throw fail('The fleets are already set', 'WRONG_PHASE');
  const fleet = validateFleet(ships);
  const boards = { ...state.boards, [player]: { ships: fleet, shots: {} } };
  const ready = [...new Set([...state.ready, player])];
  const both = ready.length === 2;
  return {
    ...state,
    boards,
    ready,
    phase: both ? 'playing' : 'placing',
    // Whoever finished setting up first shoots first.
    turn: both ? (state.turn ?? ready[0]) : state.turn,
  };
}

const shipAt = (board, cell) => board.ships.find((ship) => ship.includes(cell));
const sunk = (board, ship) => ship.every((cell) => board.shots[cell] === 'hit');

/**
 * A shot at the opponent's board. A hit keeps the turn, which is the rule
 * that makes the game a game rather than alternating coin flips.
 */
export function shoot(state, player, cell) {
  if (state.phase !== 'playing') throw fail('The game is not running', 'WRONG_PHASE');
  if (state.turn !== player) throw fail('It is not your turn', 'NOT_YOUR_TURN', 409);
  const target = Object.keys(state.boards).find((id) => id !== player);
  const board = state.boards[target];
  const index = Number(cell);
  if (!Number.isInteger(index) || index < 0 || index >= SIZE * SIZE) throw fail('That square is off the board', 'INVALID_SHOT');
  if (board.shots[index]) throw fail('You have already fired at that square', 'ALREADY_FIRED');

  const ship = shipAt(board, index);
  const result = ship ? 'hit' : 'miss';
  const shots = { ...board.shots, [index]: result };
  const nextBoard = { ...board, shots };
  const boards = { ...state.boards, [target]: nextBoard };

  const destroyed = ship && sunk(nextBoard, ship);
  const allSunk = nextBoard.ships.every((s) => sunk(nextBoard, s));

  return {
    state: {
      ...state,
      boards,
      // A hit earns another shot.
      turn: result === 'hit' ? player : target,
      phase: allSunk ? 'finished' : 'playing',
    },
    shot: { cell: index, result, sunk: Boolean(destroyed), square: squareName(index) },
    outcome: allSunk ? { over: true, result: player, reason: 'fleet-destroyed' } : { over: false },
  };
}

/**
 * What one player is allowed to see. Their own fleet in full; of the other's,
 * only the squares they have fired at — never a ship they have not found.
 */
export function viewFor(state, player) {
  const opponent = Object.keys(state.boards).find((id) => id !== player) ?? null;
  const mine = state.boards[player] ?? null;
  const theirs = opponent ? state.boards[opponent] : null;
  return {
    phase: state.phase,
    turn: state.turn,
    myFleet: mine ? mine.ships : [],
    // Shots the opponent has fired at me: my board, as they have marked it.
    incoming: mine ? mine.shots : {},
    // My shots at them, and nothing else about their board.
    outgoing: theirs ? theirs.shots : {},
    ready: state.ready,
  };
}

export function outcome(state) {
  for (const [player, board] of Object.entries(state.boards)) {
    if (board.ships.length && board.ships.every((ship) => sunk(board, ship))) {
      const winner = Object.keys(state.boards).find((id) => id !== player);
      return { over: true, result: winner, reason: 'fleet-destroyed' };
    }
  }
  return { over: false };
}

/** A legal random fleet, so nobody has to place ten ships by hand. */
export function randomFleet(random = Math.random) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const ships = [];
    const taken = new Set();
    let ok = true;
    for (const size of FLEET) {
      let placed = null;
      for (let tries = 0; tries < 300 && !placed; tries += 1) {
        const horizontal = random() < 0.5;
        const x = Math.floor(random() * (horizontal ? SIZE - size + 1 : SIZE));
        const y = Math.floor(random() * (horizontal ? SIZE : SIZE - size + 1));
        const cells = [];
        for (let i = 0; i < size; i += 1) cells.push(horizontal ? indexOf(x + i, y) : indexOf(x, y + i));
        if (cells.some((c) => taken.has(c))) continue;
        placed = cells;
      }
      if (!placed) { ok = false; break; }
      ships.push(placed);
      for (const cell of halo(placed)) taken.add(cell);
    }
    if (ok) return ships;
  }
  throw fail('Could not lay out a fleet', 'INVALID_FLEET');
}

export const describe = { kind: 'battleship', players: 2, sides: [] };
