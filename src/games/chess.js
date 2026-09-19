/**
 * Chess, with the rules the server enforces rather than trusts.
 *
 * A board sent by a client is a claim, not a fact: whoever can post state can
 * post a won position. So the server keeps the position, generates the legal
 * moves itself and accepts a move only if it is among them. That is the same
 * rule the rest of this product follows for commitments and messages.
 *
 * The board is 64 characters, index 0 = a8, 63 = h1, matching how the screen
 * draws it. Uppercase is white, lowercase is black, '.' is empty.
 */

const START = [
  'rnbqkbnr',
  'pppppppp',
  '........',
  '........',
  '........',
  '........',
  'PPPPPPPP',
  'RNBQKBNR',
].join('');

export const initialState = () => ({
  board: START,
  turn: 'w',
  // Which castles are still available, as FEN spells them.
  castling: 'KQkq',
  // The square a pawn just skipped over, or null.
  enPassant: null,
  halfmove: 0,
  fullmove: 1,
});

const WHITE_PIECES = 'PNBRQK';
const isWhite = (piece) => piece !== '.' && WHITE_PIECES.includes(piece);
const isBlack = (piece) => piece !== '.' && !WHITE_PIECES.includes(piece);
const colourOf = (piece) => (piece === '.' ? null : isWhite(piece) ? 'w' : 'b');
const fileOf = (index) => index % 8;
const rankOf = (index) => Math.floor(index / 8);
const onBoard = (file, rank) => file >= 0 && file < 8 && rank >= 0 && rank < 8;
const at = (board, file, rank) => board[rank * 8 + file];

export const squareName = (index) => `${'abcdefgh'[fileOf(index)]}${8 - rankOf(index)}`;
export const squareIndex = (name) => {
  const file = 'abcdefgh'.indexOf(String(name)[0]);
  const rank = 8 - Number(String(name)[1]);
  return onBoard(file, rank) ? rank * 8 + file : -1;
};

const put = (board, index, piece) => board.slice(0, index) + piece + board.slice(index + 1);

const SLIDES = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  q: [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]],
};
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** Moves a piece could make ignoring whether they expose its own king. */
function pseudoMoves(state, colour) {
  const { board } = state;
  const moves = [];
  const mine = colour === 'w' ? isWhite : isBlack;
  const theirs = colour === 'w' ? isBlack : isWhite;

  for (let from = 0; from < 64; from += 1) {
    const piece = board[from];
    if (piece === '.' || !mine(piece)) continue;
    const file = fileOf(from);
    const rank = rankOf(from);
    const type = piece.toLowerCase();

    if (type === 'p') {
      const forward = colour === 'w' ? -1 : 1;
      const startRank = colour === 'w' ? 6 : 1;
      const lastRank = colour === 'w' ? 0 : 7;
      const oneRank = rank + forward;
      if (onBoard(file, oneRank) && at(board, file, oneRank) === '.') {
        const to = oneRank * 8 + file;
        if (oneRank === lastRank) for (const promotion of 'qrbn') moves.push({ from, to, promotion });
        else {
          moves.push({ from, to });
          const twoRank = rank + forward * 2;
          if (rank === startRank && at(board, file, twoRank) === '.') moves.push({ from, to: twoRank * 8 + file, double: true });
        }
      }
      for (const side of [-1, 1]) {
        const captureFile = file + side;
        if (!onBoard(captureFile, oneRank)) continue;
        const target = at(board, captureFile, oneRank);
        const to = oneRank * 8 + captureFile;
        const enPassant = state.enPassant !== null && to === state.enPassant;
        if (target !== '.' && theirs(target)) {
          if (oneRank === lastRank) for (const promotion of 'qrbn') moves.push({ from, to, promotion });
          else moves.push({ from, to });
        } else if (enPassant) {
          moves.push({ from, to, enPassant: true });
        }
      }
      continue;
    }

    if (type === 'n' || type === 'k') {
      for (const [df, dr] of type === 'n' ? KNIGHT : KING) {
        const f = file + df;
        const r = rank + dr;
        if (!onBoard(f, r)) continue;
        const target = at(board, f, r);
        if (target === '.' || theirs(target)) moves.push({ from, to: r * 8 + f });
      }
      continue;
    }

    for (const [df, dr] of SLIDES[type]) {
      let f = file + df;
      let r = rank + dr;
      while (onBoard(f, r)) {
        const target = at(board, f, r);
        if (target === '.') moves.push({ from, to: r * 8 + f });
        else {
          if (theirs(target)) moves.push({ from, to: r * 8 + f });
          break;
        }
        f += df;
        r += dr;
      }
    }
  }
  return moves;
}

const kingSquare = (board, colour) => board.indexOf(colour === 'w' ? 'K' : 'k');

export function isAttacked(state, square, byColour) {
  for (const move of pseudoMoves(state, byColour)) {
    if (move.to === square) return true;
  }
  return false;
}

export function inCheck(state, colour) {
  const king = kingSquare(state.board, colour);
  if (king < 0) return false;
  return isAttacked({ ...state, turn: colour === 'w' ? 'b' : 'w' }, king, colour === 'w' ? 'b' : 'w');
}

/** Apply a move without asking whether it was legal. */
function applyMove(state, move) {
  let board = state.board;
  const piece = board[move.from];
  const type = piece.toLowerCase();
  const colour = colourOf(piece);
  const captured = board[move.to];

  board = put(board, move.from, '.');
  let placed = piece;
  if (move.promotion) placed = colour === 'w' ? move.promotion.toUpperCase() : move.promotion;
  board = put(board, move.to, placed);

  if (move.enPassant) {
    // The pawn taken in passing stands beside the destination, not on it.
    const victim = move.to + (colour === 'w' ? 8 : -8);
    board = put(board, victim, '.');
  }

  if (type === 'k' && Math.abs(fileOf(move.to) - fileOf(move.from)) === 2) {
    const rank = rankOf(move.from);
    const kingside = fileOf(move.to) === 6;
    const rookFrom = rank * 8 + (kingside ? 7 : 0);
    const rookTo = rank * 8 + (kingside ? 5 : 3);
    const rook = board[rookFrom];
    board = put(board, rookFrom, '.');
    board = put(board, rookTo, rook);
  }

  let castling = state.castling;
  const drop = (letters) => { for (const letter of letters) castling = castling.replace(letter, ''); };
  if (type === 'k') drop(colour === 'w' ? 'KQ' : 'kq');
  if (move.from === 63 || move.to === 63) drop('K');
  if (move.from === 56 || move.to === 56) drop('Q');
  if (move.from === 7 || move.to === 7) drop('k');
  if (move.from === 0 || move.to === 0) drop('q');
  if (!castling) castling = '-';

  const enPassant = move.double ? (move.from + move.to) / 2 : null;
  const resets = type === 'p' || captured !== '.';

  return {
    board,
    turn: colour === 'w' ? 'b' : 'w',
    castling,
    enPassant,
    halfmove: resets ? 0 : state.halfmove + 1,
    fullmove: colour === 'b' ? state.fullmove + 1 : state.fullmove,
  };
}

/** Castles, which need squares that are empty, unattacked and never moved. */
function castlingMoves(state, colour) {
  const moves = [];
  if (inCheck(state, colour)) return moves;
  const rank = colour === 'w' ? 7 : 0;
  const rights = colour === 'w' ? ['K', 'Q'] : ['k', 'q'];
  const enemy = colour === 'w' ? 'b' : 'w';
  const king = rank * 8 + 4;
  if (state.board[king].toLowerCase() !== 'k') return moves;

  if (state.castling.includes(rights[0])) {
    const empty = [rank * 8 + 5, rank * 8 + 6];
    if (empty.every((i) => state.board[i] === '.') && empty.every((i) => !isAttacked(state, i, enemy))) {
      moves.push({ from: king, to: rank * 8 + 6, castle: 'k' });
    }
  }
  if (state.castling.includes(rights[1])) {
    const empty = [rank * 8 + 1, rank * 8 + 2, rank * 8 + 3];
    const safe = [rank * 8 + 2, rank * 8 + 3];
    if (empty.every((i) => state.board[i] === '.') && safe.every((i) => !isAttacked(state, i, enemy))) {
      moves.push({ from: king, to: rank * 8 + 2, castle: 'q' });
    }
  }
  return moves;
}

/** Every move the side to play may actually make. */
export function legalMoves(state) {
  const colour = state.turn;
  const candidates = [...pseudoMoves(state, colour), ...castlingMoves(state, colour)];
  return candidates.filter((move) => !inCheck(applyMove(state, move), colour));
}

export function outcome(state) {
  const moves = legalMoves(state);
  if (moves.length) {
    // Bare kings cannot mate, so the game is over whatever the clock says.
    const material = [...state.board].filter((p) => p !== '.' && p.toLowerCase() !== 'k');
    if (!material.length) return { over: true, result: 'draw', reason: 'insufficient-material' };
    if (state.halfmove >= 100) return { over: true, result: 'draw', reason: 'fifty-move' };
    return { over: false };
  }
  if (inCheck(state, state.turn)) {
    return { over: true, result: state.turn === 'w' ? 'b' : 'w', reason: 'checkmate' };
  }
  return { over: true, result: 'draw', reason: 'stalemate' };
}

/**
 * Play one move. `move` names squares the way a person does — «e2», «e4» —
 * and promotion is a letter. Anything not in the legal list is refused with
 * the reason, never silently ignored.
 */
export function move(state, { from, to, promotion = null }) {
  const fromIndex = typeof from === 'number' ? from : squareIndex(from);
  const toIndex = typeof to === 'number' ? to : squareIndex(to);
  if (fromIndex < 0 || toIndex < 0) throw Object.assign(new Error('Square is off the board'), { code: 'INVALID_MOVE' });

  const legal = legalMoves(state);
  const chosen = legal.find((m) => m.from === fromIndex && m.to === toIndex
    && (m.promotion ? m.promotion === (promotion || 'q') : true));
  if (!chosen) throw Object.assign(new Error('That is not a legal move'), { code: 'ILLEGAL_MOVE' });

  const next = applyMove(state, chosen);
  const after = outcome(next);
  return {
    state: next,
    move: { ...chosen, san: `${squareName(chosen.from)}${squareName(chosen.to)}${chosen.promotion ?? ''}` },
    check: inCheck(next, next.turn),
    outcome: after,
  };
}

export const describe = {
  kind: 'chess',
  players: 2,
  // White moves first; the side is decided when the game is created.
  sides: ['w', 'b'],
};
