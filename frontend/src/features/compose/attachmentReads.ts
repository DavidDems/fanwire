import { format, parseISO } from "date-fns";

import { fetchGameDetail, fetchPlayerDetail } from "../../api/stats";
import type { components } from "../../api/schema";
import type { CareerScope, DataLink } from "./dataLink";

/**
 * The `events/` reads the attachment picker makes, and the rules and words it
 * builds from what they answer (`FRONTEND-013`).
 *
 * **No new endpoint.** A game is found through `GET /events/teams`,
 * `/events/seasons` and `/events/games?team_id&season`; a player's line in it
 * through the box score of `GET /events/games/{id}`, whose rows carry their
 * `line_id`; a career through `GET /events/players?q=` and
 * `/events/players/{id}`. Every one is asked for only when the picker is used
 * or a pre-filled address needs its summary — the composer makes no request
 * when it mounts.
 *
 * **What is offered matches what the server accepts.** `POSTS-005` refuses an
 * incomplete game, a did-not-play line and a career scope with no games, so
 * the predicates below are those three rules as the read models express them:
 * `GameOut` has no `completed` field, and both scores 0 is the backend's
 * `Game.completed` rule; a stored DNP row has `seconds_played` null; and
 * `games_played` 0 means the scope has nothing in it. The server still checks
 * at posting time, because the data can change in between.
 *
 * **The summary is the composer's own**, one line built from responses the
 * picker already holds (or, for a pre-filled address, the one read it makes).
 * It is not `FRONTEND-014`'s feed preview, which needs `POSTS-006`.
 *
 * Shared fetchers live in src/api/stats.ts; this module owns only selection
 * rules, summary wording and the pre-filled address check.
 */

export type TeamOut = components["schemas"]["TeamOut"];
export type GameOut = components["schemas"]["GameOut"];
export type GameDetailOut = components["schemas"]["GameDetailOut"];
export type BoxScorePlayerOut = components["schemas"]["BoxScorePlayerOut"];
export type TeamRefOut = components["schemas"]["TeamRefOut"];
export type PlayerListItemOut = components["schemas"]["PlayerListItemOut"];
export type PlayerDetailOut = components["schemas"]["PlayerDetailOut"];
export type StatLineOut = components["schemas"]["StatLineOut"];

// ------------------------------------------------------------ the rules

/** The backend's `Game.completed`: a game with both scores 0 has not been played. */
export function isCompleted(game: {
  home_score: number;
  away_score: number;
}): boolean {
  return !(game.home_score === 0 && game.away_score === 0);
}

/**
 * A row in `players` that is stored as a DNP has `seconds_played` null. The
 * schema types it as a number; the stored row does not always agree, so the
 * check is on the value, not the type.
 */
export function played(line: BoxScorePlayerOut): boolean {
  const seconds: number | null = line.seconds_played as number | null;
  return seconds !== null && seconds !== undefined;
}

/** One played line of a box score, with the side it was played for. */
export interface PlayedLine {
  line: BoxScorePlayerOut;
  team: TeamRefOut;
  opponent: TeamRefOut;
}

/**
 * Every line a "Player's game" may attach, home side first, each side in the
 * API's order. The `did_not_play` lists are never offered, and nor is a
 * played-shaped row stored as a DNP.
 */
export function playedLines(game: GameDetailOut): PlayedLine[] {
  const home = game.home_box_score.players.filter(played).map((line) => ({
    line,
    team: game.home_team,
    opponent: game.away_team,
  }));
  const away = game.away_box_score.players.filter(played).map((line) => ({
    line,
    team: game.away_team,
    opponent: game.home_team,
  }));
  return [...home, ...away];
}

export function careerLine(
  player: PlayerDetailOut,
  scope: CareerScope,
): StatLineOut {
  return scope === "regular" ? player.career_regular : player.career_playoffs;
}

/** The scopes a career may be attached in: those with at least one game. */
export function careerScopes(player: PlayerDetailOut): CareerScope[] {
  return (["regular", "playoffs"] as const).filter(
    (scope) => careerLine(player, scope).games_played > 0,
  );
}

// ------------------------------------------------------------ the words

const COUNT = new Intl.NumberFormat("en-US");

/**
 * Stored timestamps are naive US-Eastern (`0x02-events`), so the date is
 * read as written, never moved through a time zone.
 */
export function gameDate(date: string): string {
  return format(parseISO(date), "d MMM yyyy");
}

/** Either half of a name may be missing in the source data; never "null". */
export function playerName(player: {
  first_name: string | null;
  last_name: string | null;
}): string {
  const name = [player.first_name, player.last_name]
    .filter((part) => part !== null && part.trim() !== "")
    .join(" ");
  return name === "" ? "Unnamed player" : name;
}

export function scopeName(scope: CareerScope): string {
  return scope === "regular" ? "Regular season" : "Playoffs";
}

export function gamesPlayed(count: number): string {
  return `${COUNT.format(count)} ${count === 1 ? "game" : "games"}`;
}

/**
 * A game as one line: away team and score "at" home team and score, then the
 * date. Used for the game choices and for a game result's summary, so the two
 * read alike.
 */
export function describeGame(game: {
  homeName: string;
  awayName: string;
  home_score: number;
  away_score: number;
  date: string;
}): string {
  return `${game.awayName} ${game.away_score} at ${game.homeName} ${game.home_score} · ${gameDate(game.date)}`;
}

export function describeGameDetail(game: GameDetailOut): string {
  return describeGame({
    homeName: game.home_team.name,
    awayName: game.away_team.name,
    home_score: game.home_score,
    away_score: game.away_score,
    date: game.date,
  });
}

/** A player's line: who, for whom, against whom, when, and how many points. */
export function describeLine(game: GameDetailOut, entry: PlayedLine): string {
  return `${playerName(entry.line)} · ${entry.team.name} vs ${entry.opponent.name} · ${gameDate(game.date)} · ${entry.line.points} pts`;
}

export function describeCareer(
  player: PlayerDetailOut,
  scope: CareerScope,
): string {
  return `${playerName(player)} · ${scopeName(scope)} career · ${gamesPlayed(careerLine(player, scope).games_played)}`;
}

/**
 * The words for a link the picker knows nothing else about — one that came
 * from somewhere other than the picker or the address, such as a template.
 * Plain, but never empty, so the summary always says that something is
 * attached.
 */
export function describeBareLink(link: DataLink): string {
  switch (link.type) {
    case "game_final":
      return `Game result, game ${link.ref_id}`;
    case "player_game":
      return `Player's game, line ${link.ref_id}`;
    case "player_career":
      return `Player career, player ${link.ref_id} · ${scopeName(link.scope)}`;
  }
}

// ------------------------------------------------- the pre-filled address

/** What a pre-filled address turned out to be, once its one read has answered. */
export type AddressCheck =
  { ok: true; summary: string } | { ok: false; note: string };

const NOT_ATTACHED =
  "so nothing is attached. You can still attach stats yourself.";

function refused(reason: string): AddressCheck {
  return { ok: false, note: `${reason}, ${NOT_ATTACHED}` };
}

/**
 * Check a link from the address against what the server would accept, and
 * word its summary.
 *
 * The parser (`dataLinkIn`) has already refused anything malformed; this is
 * the half only a read can answer — the game or player exists, the game is
 * completed, the line is in that game's box score and was played, the scope
 * has games. Each failure is the same refusal the picker avoids by not
 * offering it, so the address can never attach what the picker could not.
 * A read that fails for any other reason is a note too: the composer opens
 * plain rather than half-attached.
 */
export async function checkAddressLink(
  link: DataLink,
  gameId: number | null,
): Promise<AddressCheck> {
  try {
    switch (link.type) {
      case "game_final": {
        const game = await fetchGameDetail(link.ref_id);
        if (game === null)
          return refused("The game or player in this link could not be found");
        if (!isCompleted(game))
          return refused("The game in this link has not finished yet");
        return { ok: true, summary: describeGameDetail(game) };
      }
      case "player_game": {
        if (gameId === null)
          return refused("This link does not say which game the line is in");
        const game = await fetchGameDetail(gameId);
        if (game === null)
          return refused("The game or player in this link could not be found");
        const all = [
          ...game.home_box_score.players,
          ...game.away_box_score.players,
        ];
        const line = all.find((row) => row.line_id === link.ref_id);
        if (line === undefined)
          return refused("The player's line in this link is not in that game");
        // Only played lines are offered, so a line that is there but not
        // among them is a DNP.
        const entry = playedLines(game).find(
          (candidate) => candidate.line.line_id === link.ref_id,
        );
        if (entry === undefined)
          return refused("The player in this link did not play in that game");
        return { ok: true, summary: describeLine(game, entry) };
      }
      case "player_career": {
        const player = await fetchPlayerDetail(link.ref_id);
        if (player === null)
          return refused("The game or player in this link could not be found");
        if (careerLine(player, link.scope).games_played === 0)
          return refused(
            `${playerName(player)} has no ${scopeName(link.scope).toLowerCase()} games`,
          );
        return { ok: true, summary: describeCareer(player, link.scope) };
      }
    }
  } catch {
    return refused("We could not load the stats in this link just now");
  }
}
