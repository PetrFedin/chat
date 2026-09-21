import * as chess from './chess.js';
import * as checkers from './checkers.js';
import * as battleship from './battleship.js';

/**
 * Games between colleagues.
 *
 * The rules live in the three modules beside this one and are pure: give
 * them a position and a move, get the next position or a refusal. This file
 * is the part that owns the position — because a client that owns it can
 * post a won one — and the part that decides who is allowed to touch it.
 *
 * A game belongs to a conversation, so whoever can see the room can see the
 * game and containment needs no rule of its own.
 */

export const RULES = { chess, checkers, battleship };
export const KINDS = Object.keys(RULES);

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

const view = (row, viewerId) => {
  const kind = row.kind;
  const state = row.state ?? {};
  return {
    id: row.id,
    kind,
    status: row.status,
    conversationId: row.conversationId,
    challengerId: row.challengerId,
    opponentId: row.opponentId,
    turnUserId: row.turnUserId,
    winnerId: row.winnerId,
    result: row.result,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Battleship is the one game where the position is not public: each side
    // is told its own fleet and only the squares it has fired at.
    state: kind === 'battleship' ? battleship.viewFor(state, viewerId) : state,
    yourTurn: row.turnUserId === viewerId,
    // Which colour you are. Battleship has no sides.
    side: kind === 'battleship' ? null : (row.challengerId === viewerId ? 'w' : row.opponentId === viewerId ? 'b' : null),
  };
};

export function createGameRepository(pool, store = null) {
  if (!pool) return null;

  const loadRow = async (client, session, id) => {
    const { rows } = await client.query(
      `SELECT id,conversation_id "conversationId",kind,status,challenger_id "challengerId",opponent_id "opponentId",
              turn_user_id "turnUserId",state,winner_id "winnerId",result,version,created_at "createdAt",updated_at "updatedAt"
       FROM games WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
      [session.workspaceId, id],
    );
    const row = rows[0];
    if (!row) throw fail('Game not found', 'GAME_NOT_FOUND', 404);
    return row;
  };

  const assertPlayer = (row, session) => {
    if (![row.challengerId, row.opponentId].includes(session.userId)) {
      throw fail('Game not found', 'GAME_NOT_FOUND', 404);
    }
  };

  const finish = async (client, session, row, { winnerId, result }) => {
    await client.query(
      `UPDATE games SET status='finished',turn_user_id=NULL,winner_id=$3,result=$4,finished_at=now(),updated_at=now(),version=version+1
       WHERE workspace_id=$1 AND id=$2`,
      [session.workspaceId, row.id, winnerId, result],
    );
  };

  return {
    /** Every game in a room, newest first — running ones and finished ones. */
    async listForConversation(session, conversationId, { limit = 20 } = {}) {
      if (store && !(await store.canAccessConversation(session, conversationId))) {
        throw fail('Conversation not found', 'NOT_FOUND', 404);
      }
      const { rows } = await pool.query(
        `SELECT id,conversation_id "conversationId",kind,status,challenger_id "challengerId",opponent_id "opponentId",
                turn_user_id "turnUserId",state,winner_id "winnerId",result,version,created_at "createdAt",updated_at "updatedAt"
         FROM games WHERE workspace_id=$1 AND conversation_id=$2
         ORDER BY (status IN ('invited','active')) DESC, created_at DESC LIMIT $3`,
        [session.workspaceId, conversationId, Math.min(Number(limit) || 20, 50)],
      );
      return rows.map((row) => view(row, session.userId));
    },

    /** Games waiting for this person, wherever they are. */
    async listMine(session) {
      const { rows } = await pool.query(
        `SELECT id,conversation_id "conversationId",kind,status,challenger_id "challengerId",opponent_id "opponentId",
                turn_user_id "turnUserId",state,winner_id "winnerId",result,version,created_at "createdAt",updated_at "updatedAt"
         FROM games
         WHERE workspace_id=$1 AND status IN ('invited','active') AND $2 IN (challenger_id,opponent_id)
         ORDER BY (turn_user_id=$2) DESC, updated_at DESC LIMIT 50`,
        [session.workspaceId, session.userId],
      );
      return rows.map((row) => view(row, session.userId));
    },

    async get(session, id) {
      const row = await loadRow(pool, session, id.replace?.(/ FOR UPDATE/, '') ?? id);
      if (store && !(await store.canAccessConversation(session, row.conversationId))) {
        throw fail('Game not found', 'GAME_NOT_FOUND', 404);
      }
      return view(row, session.userId);
    },

    /**
     * Challenge somebody in a room you are both in. The invitation is a
     * separate state from the game: nobody is put into a game they did not
     * agree to play.
     */
    async invite(session, { conversationId = null, kind, opponentId }) {
      if (!KINDS.includes(kind)) throw fail('Unknown game', 'UNKNOWN_GAME');
      if (opponentId === session.userId) throw fail('Nobody plays themselves', 'INVALID_OPPONENT');

      // Which room the game sits in is bookkeeping, not a decision a person
      // should have to make: asking produced a picker offering rooms the
      // opponent was not in, and a refusal after the fact. Pick the closest
      // room the two already share — the direct one first.
      if (!conversationId) {
        const { rows } = await pool.query(
          `SELECT c.id FROM conversations c
             JOIN conversation_members a ON a.workspace_id=c.workspace_id AND a.conversation_id=c.id AND a.user_id=$2
             JOIN conversation_members b ON b.workspace_id=c.workspace_id AND b.conversation_id=c.id AND b.user_id=$3
            WHERE c.workspace_id=$1 AND c.archived_at IS NULL
            ORDER BY (c.kind='direct') DESC, c.created_at DESC LIMIT 1`,
          [session.workspaceId, session.userId, opponentId],
        );
        conversationId = rows[0]?.id ?? null;
      }
      if (!conversationId) {
        // Both can still be in an open channel without a membership row.
        const { rows } = await pool.query(
          `SELECT c.id FROM conversations c
            WHERE c.workspace_id=$1 AND c.archived_at IS NULL AND c.visibility IN ('workspace','organization')
            ORDER BY c.created_at LIMIT 1`,
          [session.workspaceId],
        );
        conversationId = rows[0]?.id ?? null;
      }
      if (!conversationId) throw fail('You and this person share no room to play in', 'NO_SHARED_ROOM', 409);

      if (store && !(await store.canAccessConversation(session, conversationId))) {
        throw fail('Conversation not found', 'NOT_FOUND', 404);
      }
      const { rowCount } = await pool.query(
        `SELECT 1 FROM conversation_members WHERE workspace_id=$1 AND conversation_id=$2 AND user_id=$3`,
        [session.workspaceId, conversationId, opponentId],
      );
      // An open channel has people in it by visibility, so also accept a
      // colleague who can reach the room even without a membership row.
      if (!rowCount) {
        const { rowCount: staff } = await pool.query(
          `SELECT 1 FROM memberships m JOIN conversations c ON c.workspace_id=m.workspace_id
           WHERE m.workspace_id=$1 AND m.user_id=$2 AND c.id=$3 AND c.visibility IN ('workspace','organization') AND m.role<>'guest'`,
          [session.workspaceId, opponentId, conversationId],
        );
        if (!staff) throw fail('That person is not in this room', 'OPPONENT_NOT_HERE', 409);
      }

      try {
        const { rows } = await pool.query(
          `INSERT INTO games(organization_id,workspace_id,conversation_id,kind,challenger_id,opponent_id,state)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           RETURNING id,conversation_id "conversationId",kind,status,challenger_id "challengerId",opponent_id "opponentId",
                     turn_user_id "turnUserId",state,winner_id "winnerId",result,version,created_at "createdAt",updated_at "updatedAt"`,
          [session.organizationId, session.workspaceId, conversationId, kind, session.userId, opponentId, RULES[kind].initialState()],
        );
        return view(rows[0], session.userId);
      } catch (error) {
        if (error.code === '23505') throw fail('You already have a game of this kind going with that person', 'GAME_ALREADY_RUNNING', 409);
        throw error;
      }
    },

    /** The invited person decides. Only they can. */
    async respond(session, id, accept) {
      return this.tx(async (client) => {
        const row = await loadRow(client, session, id);
        if (row.opponentId !== session.userId) throw fail(row.challengerId === session.userId ? 'Only the invited player answers' : 'Game not found', row.challengerId === session.userId ? 'NOT_INVITED' : 'GAME_NOT_FOUND', row.challengerId === session.userId ? 403 : 404);
        if (row.status !== 'invited') throw fail('This invitation has already been answered', 'WRONG_STATUS', 409);
        if (!accept) {
          await client.query(`UPDATE games SET status='declined',turn_user_id=NULL,updated_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2`,
            [session.workspaceId, row.id]);
          return view({ ...row, status: 'declined', turnUserId: null, version: row.version + 1 }, session.userId);
        }
        // Battleship starts in its placing phase and has no side to move yet.
        const turn = row.kind === 'battleship' ? null : row.challengerId;
        await client.query(`UPDATE games SET status='active',turn_user_id=$3,updated_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2`,
          [session.workspaceId, row.id, turn]);
        return view({ ...row, status: 'active', turnUserId: turn, version: row.version + 1 }, session.userId);
      });
    },

    /** A move, checked against the rules rather than taken on trust. */
    async play(session, id, payload) {
      return this.tx(async (client) => {
        const row = await loadRow(client, session, id);
        assertPlayer(row, session);
        if (row.status !== 'active') throw fail('This game is not running', 'WRONG_STATUS', 409);
        const rules = RULES[row.kind];

        if (row.kind === 'battleship') return this.playBattleship(client, session, row, payload);

        if (row.turnUserId !== session.userId) throw fail('It is not your turn', 'NOT_YOUR_TURN', 409);
        const played = rules.move(row.state, payload);
        const ordinal = (await client.query('SELECT count(*)::int c FROM game_moves WHERE game_id=$1', [row.id])).rows[0].c + 1;
        await client.query(
          `INSERT INTO game_moves(organization_id,workspace_id,game_id,ordinal,actor_id,notation,payload)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [session.organizationId, session.workspaceId, row.id, ordinal, session.userId, played.move.san, played.move],
        );

        const sideOf = (userId) => (userId === row.challengerId ? 'w' : 'b');
        const userOfSide = (side) => (sideOf(row.challengerId) === side ? row.challengerId : row.opponentId);

        if (played.outcome.over) {
          const winnerId = played.outcome.result === 'draw' ? null : userOfSide(played.outcome.result);
          await client.query(
            `UPDATE games SET state=$3,status='finished',turn_user_id=NULL,winner_id=$4,result=$5,finished_at=now(),updated_at=now(),version=version+1
             WHERE workspace_id=$1 AND id=$2`,
            [session.workspaceId, row.id, played.state, winnerId, played.outcome.reason],
          );
          return view({ ...row, state: played.state, status: 'finished', turnUserId: null, winnerId, result: played.outcome.reason, version: row.version + 1 }, session.userId);
        }

        const turnUserId = userOfSide(played.state.turn);
        await client.query(`UPDATE games SET state=$3,turn_user_id=$4,updated_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2`,
          [session.workspaceId, row.id, played.state, turnUserId]);
        return view({ ...row, state: played.state, turnUserId, version: row.version + 1 }, session.userId);
      });
    },

    async playBattleship(client, session, row, payload) {
      if (payload.ships) {
        const next = battleship.place(row.state, session.userId, payload.ships);
        await client.query(`UPDATE games SET state=$3,turn_user_id=$4,updated_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2`,
          [session.workspaceId, row.id, next, next.turn]);
        return view({ ...row, state: next, turnUserId: next.turn, version: row.version + 1 }, session.userId);
      }
      const played = battleship.shoot(row.state, session.userId, payload.cell);
      const ordinal = (await client.query('SELECT count(*)::int c FROM game_moves WHERE game_id=$1', [row.id])).rows[0].c + 1;
      await client.query(
        `INSERT INTO game_moves(organization_id,workspace_id,game_id,ordinal,actor_id,notation,payload)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [session.organizationId, session.workspaceId, row.id, ordinal, session.userId,
         `${played.shot.square} — ${played.shot.sunk ? 'убит' : played.shot.result === 'hit' ? 'ранен' : 'мимо'}`, played.shot],
      );
      if (played.outcome.over) {
        await client.query(
          `UPDATE games SET state=$3,status='finished',turn_user_id=NULL,winner_id=$4,result=$5,finished_at=now(),updated_at=now(),version=version+1
           WHERE workspace_id=$1 AND id=$2`,
          [session.workspaceId, row.id, played.state, session.userId, played.outcome.reason],
        );
        return view({ ...row, state: played.state, status: 'finished', turnUserId: null, winnerId: session.userId, result: played.outcome.reason, version: row.version + 1 }, session.userId);
      }
      await client.query(`UPDATE games SET state=$3,turn_user_id=$4,updated_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2`,
        [session.workspaceId, row.id, played.state, played.state.turn]);
      return view({ ...row, state: played.state, turnUserId: played.state.turn, version: row.version + 1 }, session.userId);
    },

    /** Giving up is a legitimate move and is recorded as one. */
    async resign(session, id) {
      return this.tx(async (client) => {
        const row = await loadRow(client, session, id);
        assertPlayer(row, session);
        if (!['invited', 'active'].includes(row.status)) throw fail('This game is already over', 'WRONG_STATUS', 409);
        const winnerId = row.challengerId === session.userId ? row.opponentId : row.challengerId;
        await finish(client, session, row, { winnerId, result: 'resigned' });
        return view({ ...row, status: 'finished', turnUserId: null, winnerId, result: 'resigned', version: row.version + 1 }, session.userId);
      });
    },

    async moves(session, id) {
      await this.get(session, id);
      const { rows } = await pool.query(
        'SELECT ordinal,actor_id "actorId",notation,created_at "createdAt" FROM game_moves WHERE game_id=$1 ORDER BY ordinal',
        [id],
      );
      return rows;
    },

    async tx(run) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
