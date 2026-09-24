/**
 * Russian draughts, with the rules that make it that game rather than a
 * board with pieces on it.
 *
 * Two of those rules decide almost every position and are the ones a naive
 * implementation drops: capturing is compulsory when a capture exists, and a
 * capture that can continue must continue with the same piece. A man captures
 * backwards as well as forwards; a king slides any distance along a diagonal
 * and lands anywhere behind the piece it takes.
 *
 * The board is 64 characters like the chess one, index 0 = a8. 'w'/'b' are
 * men, 'W'/'B' are kings, '.' is empty. Only dark squares are used.
 */

const START = [
  '.b.b.b.b',
  'b.b.b.b.',
  '.b.b.b.b',
  '........',
  '........',
  'w.w.w.w.',
  '.w.w.w.w',
  'w.w.w.w.',
].join('');

export const initialState = () => ({ board: START, turn: 'w', chain: null });

const fileOf = (i) => i % 8;
const rankOf = (i) => Math.floor(i / 8);
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const idx = (f, r) => r * 8 + f;
const put = (board, i, piece) => board.slice(0, i) + piece + board.slice(i + 1);

const colourOf = (piece) => (piece === '.' ? null : piece.toLowerCase() === 'w' ? 'w' : 'b');
const isKing = (piece) => piece === 'W' || piece === 'B';
const DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export const squareName = (i) => `${'abcdefgh'[fileOf(i)]}${8 - rankOf(i)}`;
export const squareIndex = (name) => {
  const f = 'abcdefgh'.indexOf(String(name)[0]);
  const r = 8 - Number(String(name)[1]);
  return onBoard(f, r) ? idx(f, r) : -1;
};

/** Captures available to one piece. Empty when it has none. */
function capturesFrom(board, from) {
  const piece = board[from];
  if (piece === '.') return [];
  const colour = colourOf(piece);
  const out = [];

  for (const [df, dr] of DIRS) {
    if (isKing(piece)) {
      let f = fileOf(from) + df;
      let r = rankOf(from) + dr;
      // A king slides up to the piece it takes...
      while (onBoard(f, r) && board[idx(f, r)] === '.') { f += df; r += dr; }
      if (!onBoard(f, r)) continue;
      const victim = idx(f, r);
      if (colourOf(board[victim]) === colour) continue;
      // ...and may land on any empty square beyond it.
      let lf = f + df;
      let lr = r + dr;
      while (onBoard(lf, lr) && board[idx(lf, lr)] === '.') {
        out.push({ from, to: idx(lf, lr), victim });
        lf += df;
        lr += dr;
      }
    } else {
      // A man captures backwards too — that is the rule people forget.
      const vf = fileOf(from) + df;
      const vr = rankOf(from) + dr;
      const lf = fileOf(from) + df * 2;
      const lr = rankOf(from) + dr * 2;
      if (!onBoard(lf, lr)) continue;
      const victim = idx(vf, vr);
      if (board[victim] === '.' || colourOf(board[victim]) === colour) continue;
      if (board[idx(lf, lr)] !== '.') continue;
      out.push({ from, to: idx(lf, lr), victim });
    }
  }
  return out;
}

function quietFrom(board, from) {
  const piece = board[from];
  if (piece === '.') return [];
  const colour = colourOf(piece);
  const out = [];
  for (const [df, dr] of DIRS) {
    if (isKing(piece)) {
      let f = fileOf(from) + df;
      let r = rankOf(from) + dr;
      while (onBoard(f, r) && board[idx(f, r)] === '.') { out.push({ from, to: idx(f, r) }); f += df; r += dr; }
    } else {
      // Men walk forwards only.
      const forward = colour === 'w' ? -1 : 1;
      if (dr !== forward) continue;
      const f = fileOf(from) + df;
      const r = rankOf(from) + dr;
      if (onBoard(f, r) && board[idx(f, r)] === '.') out.push({ from, to: idx(f, r) });
    }
  }
  return out;
}

/**
 * Every move the side to play may make.
 *
 * Capturing is compulsory: when any capture exists, the quiet moves are not
 * offered at all. Mid-chain, only the piece that is capturing may move.
 */
export function legalMoves(state) {
  const { board, turn, chain } = state;
  if (chain !== null) return capturesFrom(board, chain);

  const mine = [];
  for (let i = 0; i < 64; i += 1) if (colourOf(board[i]) === turn) mine.push(i);

  const captures = mine.flatMap((from) => capturesFrom(board, from));
  if (captures.length) return captures;
  return mine.flatMap((from) => quietFrom(board, from));
}

const crowningRank = (colour) => (colour === 'w' ? 0 : 7);

export function move(state, { from, to }) {
  const fromIndex = typeof from === 'number' ? from : squareIndex(from);
  const toIndex = typeof to === 'number' ? to : squareIndex(to);
  const chosen = legalMoves(state).find((m) => m.from === fromIndex && m.to === toIndex);
  if (!chosen) throw Object.assign(new Error('Так сходить нельзя'), { code: 'ILLEGAL_MOVE' });

  let board = state.board;
  const piece = board[chosen.from];
  const colour = colourOf(piece);
  board = put(board, chosen.from, '.');
  if (chosen.victim !== undefined) board = put(board, chosen.victim, '.');

  // A man crowns on the far rank — including in the middle of a chain, and a
  // freshly crowned king carries on capturing as a king.
  let placed = piece;
  if (!isKing(piece) && rankOf(chosen.to) === crowningRank(colour)) placed = colour === 'w' ? 'W' : 'B';
  board = put(board, chosen.to, placed);

  // A capture that can continue must continue, with the same piece.
  const more = chosen.victim !== undefined && capturesFrom(board, chosen.to).length > 0;
  const next = {
    board,
    turn: more ? colour : colour === 'w' ? 'b' : 'w',
    chain: more ? chosen.to : null,
  };
  return { state: next, move: { ...chosen, san: `${squareName(chosen.from)}${chosen.victim !== undefined ? 'x' : '-'}${squareName(chosen.to)}` }, outcome: outcome(next) };
}

export function outcome(state) {
  const left = { w: 0, b: 0 };
  for (const piece of state.board) {
    const colour = colourOf(piece);
    if (colour) left[colour] += 1;
  }
  if (!left.w) return { over: true, result: 'b', reason: 'no-pieces' };
  if (!left.b) return { over: true, result: 'w', reason: 'no-pieces' };
  // A side with pieces but no move has lost: in draughts you must move.
  if (!legalMoves(state).length) return { over: true, result: state.turn === 'w' ? 'b' : 'w', reason: 'no-moves' };
  return { over: false };
}

export const describe = { kind: 'checkers', players: 2, sides: ['w', 'b'] };
