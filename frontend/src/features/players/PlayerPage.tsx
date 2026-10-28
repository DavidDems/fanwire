import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Link, useParams } from "react-router-dom";

import { offersMemberLinks, useAccount } from "../../auth/account";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { SquarePenIcon } from "../../components/ui/icons";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import {
  useComposeLinkState,
  useInFlowLinkState,
} from "../../routes/modal-flow";
import { VisuallyHidden } from "../../components/ui/VisuallyHidden";
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
import { postAboutCareerHref, type CareerScope } from "./postLinks";
import { ColumnHeader, ScrollTable } from "./ScrollTable";

/**
 * `/players/:playerId`: one player from `GET /events/players/{id}` — their
 * attributes, career lines and season-by-season table — and their game log
 * from `GET /events/players/{id}/games`, newest first.
 *
 * Public, and reached by address only (the Stats page, the leaders and the
 * game page's box scores link here; nothing imports this folder). An id the
 * backend does not know is a not-found page, not an error.
 *
 * A signed-in viewer also gets a "Post about this" link on each career row
 * with games in it (`FRONTEND-017`), to the composer's pre-filled address
 * (`postLinks.ts`); a guest sees none.
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
  // A signed-in account that is not deactivated (`FRONTEND-012`): a
  // deactivated one browses as a guest, and a guest is offered none.
  const canPost = offersMemberLinks(useAccount());
  const name = fullName(player);

  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>{name}</h1>

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
              {canPost ? (
                <th scope="col" className={styles.postCell}>
                  <VisuallyHidden>Post</VisuallyHidden>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            <CareerRow
              label="Regular season"
              line={player.career_regular}
              post={
                canPost ? { playerId: player.id, name, scope: "regular" } : null
              }
            />
            <CareerRow
              label="Playoffs"
              line={player.career_playoffs}
              post={
                canPost
                  ? { playerId: player.id, name, scope: "playoffs" }
                  : null
              }
            />
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

      <GameLog playerId={player.id} playerName={name} />
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

/** What a signed-in viewer's career-row post link is about. */
interface CareerPost {
  playerId: number;
  name: string;
  scope: CareerScope;
}

/**
 * One career line. With `post` (signed in) it gains a trailing cell: a
 * "Post about this" link, or nothing for a scope with no games.
 */
function CareerRow({
  label,
  line,
  post,
}: {
  label: string;
  line: StatLineOut;
  post: CareerPost | null;
}) {
  // FRONTEND-020: "Post" opens the composer over this page (or the flow's).
  const composeState = useComposeLinkState();
  return (
    <tr>
      <th scope="row" className={styles.name}>
        {label}
      </th>
      <AverageCells line={line} />
      {post === null ? null : (
        <td className={styles.postCell}>
          {line.games_played === 0 ? null : (
            <Link
              to={postAboutCareerHref(post.playerId, post.scope)}
              state={composeState}
              className={styles.postLink}
            >
              <SquarePenIcon size={16} />
              Post
              <VisuallyHidden>
                {` about ${post.name}’s ${label.toLowerCase()}`}
              </VisuallyHidden>
            </Link>
          )}
        </td>
      )}
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

function GameLog({
  playerId,
  playerName,
}: {
  playerId: number;
  playerName: string;
}) {
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
      {games.isSuccess && items.length > 0 ? (
        <PlayerPointsChart games={items} name={playerName} />
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

function PlayerPointsChart({
  games,
  name,
}: {
  games: PlayerGameOut[];
  name: string;
}) {
  const plotted = games
    .filter((game) => game.seconds_played !== null)
    .slice(0, 10)
    .reverse();
  const maximum = Math.max(0, ...plotted.map((game) => game.points));
  const top = (Math.floor(maximum / 5) + 1) * 5;
  const ticks = Array.from({ length: top / 5 + 1 }, (_, index) => index * 5);
  const left = 42;
  const right = 584;
  const topY = 12;
  const bottom = 142;
  const points = plotted.map((game, index) => ({
    game,
    x: plotted.length < 2 ? (left + right) / 2 : left + ((right - left) * index) / (plotted.length - 1),
    y: bottom - (game.points / top) * (bottom - topY),
  }));

  return (
    <div className={styles.chart}>
      {plotted.length >= 2 ? (
        <svg
          className={styles.chartSvg}
          viewBox="0 0 600 184"
          role="img"
          aria-label={`Points for ${name}, last ${plotted.length} completed games`}
        >
          {ticks.map((tick) => {
            const y = bottom - (tick / top) * (bottom - topY);
            return (
              <g key={tick}>
                <line className={styles.chartGrid} x1={left} x2={right} y1={y} y2={y} />
                <text className={styles.chartAxis} x={left - 8} y={y + 4} textAnchor="end"> {tick} </text>
              </g>
            );
          })}
          {points.slice(1).map((point, index) => {
            const previous = points[index];
            const dx = point.x - previous.x;
            const dy = point.y - previous.y;
            const length = Math.hypot(dx, dy);
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return (
              <line
                key={index}
                className={styles.chartLine}
                x1={0}
                x2={1}
                y1={0}
                y2={0}
                transform={`translate(${previous.x} ${previous.y}) rotate(${angle}) scale(${length} 1)`}
              />
            );
          })}
          {points.map(({ x, y }, index) => (
            <circle
              key={index}
              className={styles.chartPoint}
              cx={0}
              cy={0}
              r={4}
              transform={`translate(${x} ${y})`}
            />
          ))}
          {points.map(({ game, x }, index) => (
            <text key={index} className={styles.chartAxis} x={x} y={166} textAnchor="middle">
              {format(parseISO(game.date), "MMM d")}
            </text>
          ))}
        </svg>
      ) : (
        <p className={styles.chartNote}>
          {plotted.length === 0
            ? "There are no completed games to chart."
            : "At least two completed games are needed to draw a line."}
        </p>
      )}
      <ScrollTable caption={`Points for ${name}, last ${plotted.length} completed games`}>
        <thead>
          <tr>
            <ColumnHeader label="Date" name />
            <ColumnHeader label="Points" />
          </tr>
        </thead>
        <tbody>
          {plotted.map((game) => (
            <tr key={game.game_id}>
              <th scope="row" className={styles.name}>{formatGameDate(game.date)}</th>
              <td>{game.points}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </div>
  );
}

function GameLogRow({ game }: { game: PlayerGameOut }) {
  const won = game.team_score > game.opponent_score;
  // Inside the modal, a game is the flow's next detail; on the page, a plain
  // link to the game's page.
  const state = useInFlowLinkState();

  return (
    <tr>
      <th scope="row" className={styles.name}>
        <Link to={`/games/${game.game_id}`} state={state}>
          {formatGameDate(game.date)}
        </Link>
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
