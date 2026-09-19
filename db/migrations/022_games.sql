-- Games colleagues play with each other: chess, draughts, battleship.
--
-- A game is not a message. It has two players, a side to move, a position
-- and a result, and the position is the thing a client must not be trusted
-- with: whoever can post state can post a won one. The server keeps it and
-- accepts a move only if its own rules generated that move — the same shape
-- the rest of this product uses for commitments.
--
-- It lives in a conversation, so the people who can see the room are the
-- people who can see the game, and containment needs no separate rule.

CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('chess','checkers','battleship')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','finished','declined','abandoned')),
  -- Who is playing. The challenger holds the first side of the game.
  challenger_id uuid NOT NULL,
  opponent_id uuid NOT NULL,
  -- Whose move it is. Null before the game starts and after it ends.
  turn_user_id uuid,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  winner_id uuid,
  -- 'checkmate', 'resigned', 'fleet-destroyed', 'draw'… why it ended.
  result text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, challenger_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, opponent_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  -- Nobody plays themselves.
  CHECK (challenger_id <> opponent_id),
  -- A finished game names when, and only a finished one has a result.
  CHECK ((status = 'finished') = (finished_at IS NOT NULL)),
  CHECK (status <> 'finished' OR result IS NOT NULL),
  -- A winner is one of the two players, or nobody on a draw.
  CHECK (winner_id IS NULL OR winner_id IN (challenger_id, opponent_id))
);

-- Two people have one live game of a kind between them at a time: a second
-- invitation is a mistake, not a feature.
CREATE UNIQUE INDEX games_one_live_idx ON games(
  workspace_id, kind,
  least(challenger_id, opponent_id), greatest(challenger_id, opponent_id)
) WHERE status IN ('invited','active');

CREATE INDEX games_conversation_idx ON games(workspace_id, conversation_id, created_at DESC);
CREATE INDEX games_player_idx ON games(workspace_id, challenger_id, opponent_id) WHERE status IN ('invited','active');

-- Every move, in order, append-only. The board can be replayed from these
-- rather than taken on trust, and a game people argue about has an answer.
CREATE TABLE game_moves (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  actor_id uuid NOT NULL,
  -- «e2e4», «c3xd4», «ж5» — what was played, as a person would write it.
  notation text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  UNIQUE (game_id, ordinal)
);

CREATE INDEX game_moves_game_idx ON game_moves(game_id, ordinal);
