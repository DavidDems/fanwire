import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Link, useParams } from "react-router-dom";

import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import {
  formatAverage,
  formatGameDate,
  formatHeight,
  formatMadeAttempted,
  formatMinutes,
  formatPercentage,
  formatPlusMinus,
} from "../games/format";
import {
  GAME_LOG_PAGE_SIZE,
  fetchPlayer,
  fetchPlayerGamesPage,
  playerGamesKey,
  playerKey,
  type PlayerDetailOut,
  type PlayerGameOut,
  type StatLineOut,
} from "./api";
import styles from "./Players.module.css";
import { ColumnHeader, ScrollTable } from "./ScrollTable";

/**
 * `/players/:playerId`: one player from `GET /events/players/{id}` — their
 * attributes, career lines and season-by-season table — and their game log
 * from `GET /events/players/{id}/games`, newest first.
 *
 * Public, and reached by address only (the Stats page, the leaders and the
 * game page's box scores link here; nothing imports this folder). An id the
 * backend does not know is a not-found page, not an error.
 */
export function PlayerPage() {
  const { playerId: raw } = useParams();
  const playerId = Number(raw);
  const valid = Number.isSafeInteger(playerId) && playerId > 0;

  const player = useQuery({
    queryKey: playerKey(playerId),
    queryFn: () => fetchPlayer(playerId),
    enabled: valid,
  });

  if (!valid || player.data === null) return <PlayerNotFound />;

  if (player.isError) {
    return (
      <section className={styles.page}>
        <InlineAlert>
          We could not load this player just now. Please try again.
        </InlineAlert>
      </section>
    );
  }

  if (player.data === undefined) {
    return (
      <section className={styles.page}>
        <StatusLine>Loading the player…</StatusLine>
      </section>
    );
  }

  return <Player player={player.data} />;
}

function PlayerNotFound() {
  return (
    <section className={styles.page}>
      <h1>Player not found</h1>
      <p>
        We could not find that player. The link may be mistyped or out of date.
      </p>
      <p>
        <Link to="/stats/players">Search for a player</Link>
      </p>
    </section>
  );
}

function fullName(player: PlayerDetailOut): string {
  const name = [player.first_name, player.last_name]
    .filter((part): part is string => part !== null && part !== "")
    .join(" ");
  return name === "" ? `Player ${player.id}` : name;
}

function formatBirthDate(value: string): string {
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "d MMMM yyyy");
}

function formatDraft(player: PlayerDetailOut): string | null {
  if (player.draft_year === null) return null;
  const parts = [String(player.draft_year)];
  if (player.draft_round !== null) parts.push(`round ${player.draft_round}`);
  if (player.draft_number !== null) parts.push(`pick ${player.draft_number}`);
  return parts.join(", ");
}

function Player({ player }: { player: PlayerDetailOut }) {
  // Every attribute the API may not know is left out rather than printed.
  const facts: [string, string | null][] = [
    ["Position", player.position],
    ["Jersey", player.jersey === null ? null : `#${player.jersey}`],
    [
      "Height",
      player.height_inches === null ? null : formatHeight(player.height_inches),
    ],
    ["Weight", player.weight_lbs === null ? null : `${player.weight_lbs} lb`],
    [
      "Born",
      player.birth_date === null ? null : formatBirthDate(player.birth_date),
    ],
    ["Country", player.country],
    ["School", player.school],
    ["Draft", formatDraft(player)],
    [
      "Seasons",
      player.first_season === null || player.last_season === null
        ? null
        : `${player.first_season} to ${player.last_season}`,
    ],
  ];
  const known = facts.filter(
    (fact): fact is [string, string] => fact[1] !== null && fact[1] !== "",
  );

  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>{fullName(player)}</h1>

      {known.length === 0 ? null : (
        <dl className={styles.facts}>
          {known.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section className={styles.section} aria-labelledby="player-career">
        <h2 id="player-career">Career</h2>
        <ScrollTable caption="Career averages">
          <thead>
            <tr>
              <ColumnHeader label="Games" name />
              {AVERAGE_COLUMNS.map(([label, title]) => (
                <ColumnHeader key={label} label={label} title={title} />
              ))}
            </tr>
          </thead>
          <tbody>
            <CareerRow label="Regular season" line={player.career_regular} />
            <CareerRow label="Playoffs" line={player.career_playoffs} />
          </tbody>
        </ScrollTable>
      </section>

      <section className={styles.section} aria-labelledby="player-seasons">
        <h2 id="player-seasons">Seasons</h2>
        {player.seasons.length === 0 ? (
          <EmptyState>
            There are no seasons on record for this player.
          </EmptyState>
        ) : (
          <ScrollTable caption="Season by season">
            <thead>
              <tr>
                <ColumnHeader label="Season" name />
                <ColumnHeader label="Type" name />
                <ColumnHeader label="Teams" name />
                {AVERAGE_COLUMNS.map(([label, title]) => (
                  <ColumnHeader key={label} label={label} title={title} />
                ))}
              </tr>
            </thead>
            <tbody>
              {player.seasons.map((line) => (
                <tr key={`${line.season}-${line.game_type}`}>
                  <th scope="row" className={styles.name}>
                    {line.season}
                  </th>
                  <td className={styles.name}>
                    {line.game_type === "playoffs"
                      ? "Playoffs"
                      : "Regular season"}
                  </td>
                  <td className={styles.name}>{line.teams.join(", ")}</td>
                  <AverageCells line={line} />
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        )}
      </section>

      <GameLog playerId={player.id} />
    </section>
  );
}

/** The columns a career or season line shares, with each one's full name. */
const AVERAGE_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["GP", "Games played"],
  ["GS", "Games started"],
  ["MIN", "Minutes per game"],
  ["PTS", "Points per game"],
  ["REB", "Rebounds per game"],
  ["AST", "Assists per game"],
  ["STL", "Steals per game"],
  ["BLK", "Blocks per game"],
  ["FG%", "Field goal percentage"],
  ["3P%", "Three-point percentage"],
  ["FT%", "Free throw percentage"],
];

function AverageCells({ line }: { line: StatLineOut }) {
  return (
    <>
      <td>{line.games_played}</td>
      <td>{line.games_started}</td>
      <td>{formatAverage(line.minutes_per_game)}</td>
      <td className={styles.figure}>{formatAverage(line.points_per_game)}</td>
      <td>{formatAverage(line.rebounds_per_game)}</td>
      <td>{formatAverage(line.assists_per_game)}</td>
      <td>{formatAverage(line.steals_per_game)}</td>
      <td>{formatAverage(line.blocks_per_game)}</td>
      <td>{formatPercentage(line.field_goal_pct)}</td>
      <td>{formatPercentage(line.three_point_pct)}</td>
      <td>{formatPercentage(line.free_throw_pct)}</td>
    </>
  );
}

function CareerRow({ label, line }: { label: string; line: StatLineOut }) {
  return (
    <tr>
      <th scope="row" className={styles.name}>
        {label}
      </th>
      <AverageCells line={line} />
    </tr>
  );
}

/** The game log's figure columns, after Date, Opponent and Result. */
const LOG_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["MIN", "Minutes"],
  ["PTS", "Points"],
  ["REB", "Rebounds"],
  ["AST", "Assists"],
  ["STL", "Steals"],
  ["BLK", "Blocks"],
  ["FG", "Field goals made-attempted"],
  ["3P", "Three-pointers made-attempted"],
  ["FT", "Free throws made-attempted"],
  ["+/-", "Plus-minus"],
];

function GameLog({ playerId }: { playerId: number }) {
  const games = useInfiniteQuery({
    queryKey: playerGamesKey(playerId),
    queryFn: ({ pageParam }) => fetchPlayerGamesPage(playerId, pageParam),
    initialPageParam: 0,
    // A bare list: a full page is the only sign another may follow.
    getNextPageParam: (lastPage, _pages, lastOffset) =>
      lastPage.length < GAME_LOG_PAGE_SIZE
        ? undefined
        : lastOffset + GAME_LOG_PAGE_SIZE,
  });
  const items = (games.data?.pages ?? []).flat();

  return (
    <section className={styles.section} aria-labelledby="player-game-log">
      <h2 id="player-game-log">Game log</h2>
      {games.isPending ? <StatusLine>Loading the game log…</StatusLine> : null}
      {games.isError ? (
        <InlineAlert>
          We could not load this player’s games just now. Please try again.
        </InlineAlert>
      ) : null}
      {games.isSuccess && items.length === 0 ? (
        <EmptyState>There are no games on record for this player.</EmptyState>
      ) : null}
      {items.length === 0 ? null : (
        <ScrollTable caption="Games played, newest first">
          <thead>
            <tr>
              <ColumnHeader label="Date" name />
              <ColumnHeader label="Opponent" name />
              <ColumnHeader label="Result" name />
              {LOG_COLUMNS.map(([label, title]) => (
                <ColumnHeader key={label} label={label} title={title} />
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((game) => (
              <GameLogRow key={game.game_id} game={game} />
            ))}
          </tbody>
        </ScrollTable>
      )}
      {!games.hasNextPage ? null : (
        <Button
          type="button"
          variant="secondary"
          size="md"
          className={styles.more}
          onClick={() => void games.fetchNextPage()}
          disabled={games.isFetchingNextPage}
        >
          Load more games
        </Button>
      )}
    </section>
  );
}

function GameLogRow({ game }: { game: PlayerGameOut }) {
  const won = game.team_score > game.opponent_score;

  return (
    <tr>
      <th scope="row" className={styles.name}>
        <Link to={`/games/${game.game_id}`}>{formatGameDate(game.date)}</Link>
      </th>
      <td className={styles.name}>
        {game.is_home ? "vs " : "at "}
        {game.opponent.abbreviation}
        {game.game_type === "playoffs" ? (
          <span className={styles.muted}> (playoffs)</span>
        ) : null}
      </td>
      <td className={styles.name}>
        {/* The result in a letter and a word, never by colour alone. */}
        <abbr title={won ? "Won" : "Lost"}>{won ? "W" : "L"}</abbr>{" "}
        {`${game.team_score}-${game.opponent_score}`}
      </td>
      {game.seconds_played === null ? (
        <td className={styles.name} colSpan={LOG_COLUMNS.length}>
          {game.dnp_reason ?? "Did not play"}
        </td>
      ) : (
        <>
          <td>{formatMinutes(game.seconds_played)}</td>
          <td className={styles.figure}>{game.points}</td>
          <td>{game.rebounds}</td>
          <td>{game.assists}</td>
          <td>{game.steals}</td>
          <td>{game.blocks}</td>
          <td>
            {formatMadeAttempted(
              game.field_goals_made,
              game.field_goals_attempted,
            )}
          </td>
          <td>
            {formatMadeAttempted(
              game.three_pointers_made,
              game.three_pointers_attempted,
            )}
          </td>
          <td>
            {formatMadeAttempted(
              game.free_throws_made,
              game.free_throws_attempted,
            )}
          </td>
          <td>{formatPlusMinus(game.plus_minus)}</td>
        </>
      )}
    </tr>
  );
}
