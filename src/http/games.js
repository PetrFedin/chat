import { json, noContent, readJson } from './helpers.js';
import { isGuest } from '../persistence/visibility.js';

const ID = '([0-9a-f-]{36})';
const GAME = new RegExp(`^/api/v1/games/${ID}$`, 'i');
const RESPOND = new RegExp(`^/api/v1/games/${ID}/respond$`, 'i');
const MOVES = new RegExp(`^/api/v1/games/${ID}/moves$`, 'i');
const RESIGN = new RegExp(`^/api/v1/games/${ID}/resign$`, 'i');

const unavailable = () => Object.assign(
  new Error('Games require a database deployment'),
  { code: 'GAMES_UNAVAILABLE', statusCode: 503, expose: true },
);

export function createGamesHandler() {
  return async function handleGames(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/games')) return false;
    const session = await ctx.requireSession(req);

    // A guest is somebody else's employee, here for one piece of work. The
    // company's games are not part of it.
    if (isGuest(session)) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND', statusCode: 404 });

    const games = ctx.games;
    if (!games) throw unavailable();

    if (method === 'GET' && path === '/api/v1/games') {
      const conversationId = url.searchParams.get('conversationId');
      json(res, 200, {
        items: conversationId
          ? await games.listForConversation(session, conversationId)
          : await games.listMine(session),
      });
      return true;
    }

    if (method === 'POST' && path === '/api/v1/games') {
      const body = await readJson(req);
      const game = await games.invite(session, {
        conversationId: String(body.conversationId ?? ''),
        kind: String(body.kind ?? ''),
        opponentId: String(body.opponentId ?? ''),
      });
      ctx.hub.broadcastUsers(session.workspaceId, [game.challengerId, game.opponentId], 'game.updated', { gameId: game.id });
      await ctx.notifyUsers(session.workspaceId, [game.opponentId], {
        title: 'Приглашение в игру', body: GAME_NAME[game.kind] ?? game.kind, url: '/#/games', kind: 'game.move',
      });
      json(res, 201, { game });
      return true;
    }

    let m = path.match(RESPOND);
    if (m && method === 'POST') {
      const body = await readJson(req);
      const game = await games.respond(session, m[1], Boolean(body.accept));
      ctx.hub.broadcastUsers(session.workspaceId, [game.challengerId, game.opponentId], 'game.updated', { gameId: game.id });
      json(res, 200, { game });
      return true;
    }

    m = path.match(MOVES);
    if (m && method === 'POST') {
      const body = await readJson(req);
      const game = await games.play(session, m[1], body);
      ctx.hub.broadcastUsers(session.workspaceId, [game.challengerId, game.opponentId], 'game.updated', { gameId: game.id });
      json(res, 200, { game });
      return true;
    }
    if (m && method === 'GET') { json(res, 200, { items: await games.moves(session, m[1]) }); return true; }

    m = path.match(RESIGN);
    if (m && method === 'POST') {
      const game = await games.resign(session, m[1]);
      ctx.hub.broadcastUsers(session.workspaceId, [game.challengerId, game.opponentId], 'game.updated', { gameId: game.id });
      json(res, 200, { game });
      return true;
    }

    m = path.match(GAME);
    if (m && method === 'GET') { json(res, 200, { game: await games.get(session, m[1]) }); return true; }

    throw Object.assign(new Error('Game route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}

const GAME_NAME = { chess: 'Шахматы', checkers: 'Шашки', battleship: 'Морской бой' };
