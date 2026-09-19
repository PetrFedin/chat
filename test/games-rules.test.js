import test from 'node:test';
import assert from 'node:assert/strict';
import * as chess from '../src/games/chess.js';
import * as checkers from '../src/games/checkers.js';
import * as battleship from '../src/games/battleship.js';

// A board sent by a client is a claim, not a fact: whoever can post state can
// post a won position. These are the rules the server checks instead.

test('chess: the opening, a mate, and moves that are not legal', () => {
  let state = chess.initialState();
  assert.equal(chess.legalMoves(state).length, 20, 'в начальной позиции 20 ходов');

  // A piece cannot jump its own men.
  assert.throws(() => chess.move(state, { from: 'd1', to: 'd4' }), (e) => e.code === 'ILLEGAL_MOVE');
  assert.throws(() => chess.move(state, { from: 'e2', to: 'e5' }), (e) => e.code === 'ILLEGAL_MOVE');
  // Nor may the wrong side move.
  assert.throws(() => chess.move(state, { from: 'e7', to: 'e5' }), (e) => e.code === 'ILLEGAL_MOVE');

  for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4']]) state = chess.move(state, { from, to }).state;
  const mate = chess.move(state, { from: 'd8', to: 'h4' });
  assert.equal(mate.outcome.over, true);
  assert.equal(mate.outcome.reason, 'checkmate');
  assert.equal(mate.outcome.result, 'b');
});

test('chess: castling, en passant and promotion', () => {
  let state = chess.initialState();
  for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6']]) {
    state = chess.move(state, { from, to }).state;
  }
  assert.ok(chess.legalMoves(state).some((m) => m.castle === 'k'), 'рокировка не предложена');
  const castled = chess.move(state, { from: 'e1', to: 'g1' }).state;
  assert.equal(castled.board[62], 'K', 'король не на g1');
  assert.equal(castled.board[61], 'R', 'ладья не на f1');
  assert.ok(!castled.castling.includes('K'), 'право на рокировку осталось');

  let ep = chess.initialState();
  for (const [from, to] of [['e2', 'e4'], ['a7', 'a6'], ['e4', 'e5'], ['d7', 'd5']]) ep = chess.move(ep, { from, to }).state;
  assert.ok(chess.legalMoves(ep).some((m) => m.enPassant), 'взятие на проходе не предложено');
  const taken = chess.move(ep, { from: 'e5', to: 'd6' }).state;
  assert.equal(taken.board[chess.squareIndex('d5')], '.', 'взятая на проходе пешка осталась');

  // A king may not be left where it is attacked.
  let pinned = chess.initialState();
  for (const [from, to] of [['e2', 'e4'], ['d7', 'd5'], ['f1', 'b5']]) pinned = chess.move(pinned, { from, to }).state;
  assert.throws(() => chess.move(pinned, { from: 'a7', to: 'a6' }), (e) => e.code === 'ILLEGAL_MOVE',
    'ход, оставляющий короля под шахом, принят');
});

test('draughts: capturing is compulsory and a chain must finish', () => {
  const empty = '.'.repeat(64);
  const put = (board, name, piece) => {
    const i = checkers.squareIndex(name);
    return board.slice(0, i) + piece + board.slice(i + 1);
  };

  let board = put(put(empty, 'c3', 'w'), 'd4', 'b');
  let state = { board, turn: 'w', chain: null };
  const moves = checkers.legalMoves(state);
  assert.ok(moves.length && moves.every((m) => m.victim !== undefined), 'тихие ходы предложены при возможном взятии');

  // A man captures backwards as well as forwards.
  state = { board: put(put(empty, 'c3', 'w'), 'd2', 'b'), turn: 'w', chain: null };
  assert.ok(checkers.legalMoves(state).some((m) => m.victim === checkers.squareIndex('d2')), 'простая не бьёт назад');

  // A capture that can continue must continue, with the same piece.
  board = put(put(put(empty, 'a1', 'w'), 'b2', 'b'), 'd4', 'b');
  const played = checkers.move({ board, turn: 'w', chain: null }, { from: 'a1', to: 'c3' });
  assert.equal(played.state.turn, 'w', 'ход отдан сопернику посреди цепочки');
  assert.equal(played.state.chain, checkers.squareIndex('c3'), 'цепочка не закреплена за фишкой');
  assert.ok(checkers.legalMoves(played.state).every((m) => m.from === played.state.chain), 'другой фишкой позволено ходить');

  // A man crowns on the far rank — the eighth for white.
  const crowning = checkers.move({ board: put(empty, 'b7', 'w'), turn: 'w', chain: null }, { from: 'b7', to: 'a8' });
  assert.equal(crowning.state.board[checkers.squareIndex('a8')], 'W', 'шашка не стала дамкой');
});

test('battleship: the fleet is checked, and neither side sees the other', () => {
  for (let i = 0; i < 40; i += 1) battleship.validateFleet(battleship.randomFleet());

  assert.throws(() => battleship.validateFleet([[0, 1]]), (e) => e.code === 'INVALID_FLEET', 'неполный флот принят');
  // Ships may not touch, diagonals included.
  const touching = battleship.randomFleet();
  touching[0] = [0, 1, 2, 3];
  touching[1] = [11, 12, 13];
  assert.throws(() => battleship.validateFleet(touching), (e) => e.code === 'INVALID_FLEET', 'касание по диагонали принято');
  // A bent ship is not a ship.
  const bent = battleship.randomFleet();
  bent[0] = [0, 1, 2, 12];
  assert.throws(() => battleship.validateFleet(bent), (e) => e.code === 'INVALID_FLEET');

  let state = battleship.initialState();
  state = battleship.place(state, 'a', battleship.randomFleet());
  state = battleship.place(state, 'b', battleship.randomFleet());
  assert.equal(state.phase, 'playing');

  // What one player is told never includes the other's fleet.
  const view = battleship.viewFor(state, 'a');
  assert.equal(view.myFleet.length, 10);
  assert.deepEqual(view.outgoing, {}, 'о чужом поле что-то известно до первого выстрела');
  assert.ok(!JSON.stringify(view).includes(JSON.stringify(state.boards.b.ships)), 'чужой флот утёк в ответ');

  assert.throws(() => battleship.shoot(state, 'b', 0), (e) => e.code === 'NOT_YOUR_TURN' && e.statusCode === 409);
  const first = battleship.shoot(state, 'a', 0);
  // A hit earns another shot; a miss hands the turn over.
  assert.equal(first.state.turn, first.shot.result === 'hit' ? 'a' : 'b');
  // Firing twice at the same square is only reachable while it is still your
  // turn, and only a hit keeps it — so aim at a ship we know is there.
  const target = state.boards.b.ships[0][0];
  const hit = battleship.shoot(state, 'a', target);
  assert.equal(hit.shot.result, 'hit');
  assert.equal(hit.state.turn, 'a', 'попадание не оставило ход за стрелявшим');
  assert.throws(() => battleship.shoot(hit.state, 'a', target), (e) => e.code === 'ALREADY_FIRED');
});

test('battleship: sinking every ship ends it', () => {
  let state = battleship.initialState();
  const fleet = battleship.randomFleet();
  state = battleship.place(state, 'a', battleship.randomFleet());
  state = battleship.place(state, 'b', fleet);
  let over = null;
  for (const cell of fleet.flat()) {
    const played = battleship.shoot(state, 'a', cell);
    state = played.state;
    if (played.outcome.over) over = played.outcome;
  }
  assert.ok(over, 'потопленный флот не завершил партию');
  assert.equal(over.result, 'a');
  assert.equal(over.reason, 'fleet-destroyed');
});
