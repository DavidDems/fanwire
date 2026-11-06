import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { format, parseISO } from "date-fns";

import {
  TEAMS_KEY,
  teamSeasonQuery,
  type TeamOut,
  type TeamSeasonGameOut,
  type TeamSeasonOut,
} from "../../api/stats";
import { EmptyState } from "../ui/EmptyState";
import { InlineAlert } from "../ui/InlineAlert";
import { Skeleton } from "../ui/Skeleton";
import { StatusLine } from "../ui/StatusLine";
import { TeamIcon } from "../ui/TeamIcon";
import { VisuallyHidden } from "../ui/VisuallyHidden";
import { teamShortName } from "../../features/games/format";
import { formatGameType, formatRecord } from "./labels";
import { LevelLink } from "./LevelLink";
import { ColumnHeader, ScrollTable } from "./ScrollTable";
import styles from "./StatsNav.module.css";
import type { StatsLevel, StatsNavAdapter } from "./types";

type TeamLevelData = Extract<StatsLevel, { kind: "team" }>;

/**
 * A team's name for its level: from the teams list when it is already cached
 * (read without asking), else from the team's season (the read its view
 * makes), else "Team".
 */
export function TeamName({
  teamId,
  season,
}: {
  teamId: number;
  season: string;
}) {
  const cached = useQueryClient()
    .getQueryData<TeamOut[]>(TEAMS_KEY)
    ?.find((team) => team.id === teamId)?.name;
  const teamSeason = useQuery(teamSeasonQuery(teamId, season));
  return <>{cached ?? teamSeason.data?.team.name ?? "Team"}</>;
}

/**
 * The team's icon for its level's heading, beside its name (so hidden):
 * the abbreviation from the same reads as `TeamName`, the neutral form
 * until one has it.
 */
export function TeamNameIcon({
  teamId,
  season,
}: {
  teamId: number;
  season: string;
}) {
  const cached = useQueryClient()
    .getQueryData<TeamOut[]>(TEAMS_KEY)
    ?.find((team) => team.id === teamId)?.abbreviation;
  const teamSeason = useQuery(teamSeasonQuery(teamId, season));
  return (
    <TeamIcon
      abbreviation={cached ?? teamSeason.data?.team.abbreviation}
      size="sm"
    />
  );
}

/**
 * The team season level: the team's record and home and away splits, the
 * cumulative record chart, then its games as result cards from its own side,
 * newest first (the API's order). Each card is one control: the game's link,
 * carrying the level's season, or in select mode the game's level.
 */
export function TeamLevel({
  level,
  adapter,
  onGame,
}: {
  level: TeamLevelData;
  adapter: StatsNavAdapter;
  onGame?: (gameId: number) => void;
}) {
  const teamSeason = useQuery({
    ...teamSeasonQuery(level.teamId, level.season),
    placeholderData: keepPreviousData,
  });

  if (teamSeason.isPending)
    return (
      <>
        <StatusLine>Loading the team’s season…</StatusLine>
        <Skeleton variant="line" />
      </>
    );
  if (teamSeason.isError)
    return (
      <InlineAlert>
        We could not load this team’s season just now. Please try again.
      </InlineAlert>
    );
  if (teamSeason.data === null)
    return (
      <EmptyState>There is no {level.season} season for that team.</EmptyState>
    );

  return (
    <>
      {teamSeason.isPlaceholderData ? (
        <StatusLine>Updating the team season...</StatusLine>
      ) : null}
      <TeamSeason data={teamSeason.data} adapter={adapter} onGame={onGame} />
    </>
  );
}

function TeamSeason({
  data,
  adapter,
  onGame,
}: {
  data: TeamSeasonOut;
  adapter: StatsNavAdapter;
  onGame?: (gameId: number) => void;
}) {
  const { team, record, season, games } = data;

  return (
    <>
      <dl className={styles.facts}>
        <div>
          <dt>Record</dt>
          <dd>{formatRecord(record.wins, record.losses)}</dd>
        </div>
        <div>
          <dt>Home</dt>
          <dd>{formatRecord(record.home_wins, record.home_losses)}</dd>
        </div>
        <div>
          <dt>Away</dt>
          <dd>{formatRecord(record.away_wins, record.away_losses)}</dd>
        </div>
      </dl>

      {games.length === 0 ? (
        <EmptyState>
          {team.name} played no games in {season}.
        </EmptyState>
      ) : (
        <>
          {games.some(isPlayed) ? (
            <RecordChart
              games={games.filter(isPlayed)}
              teamName={team.name}
              season={season}
            />
          ) : null}
          <div className={styles.resultsWrap}>
            <ul className={styles.results}>
              {games.map((game) => {
                const card = <ResultCard game={game} teamName={team.name} />;
                return (
                  <li key={game.game_id}>
                    {onGame ? (
                      <LevelLink
                        level={{ kind: "game", gameId: game.game_id }}
                        adapter={adapter}
                        onGo={() => onGame(game.game_id)}
                      >
                        {card}
                      </LevelLink>
                    ) : (
                      adapter.gameLink(game.game_id, card, season)
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Whether a game has been played: 0-0 is a scheduled game (the API sends it
 * as `won: false`), so it has no result and adds nothing to the record.
 */
function isPlayed(game: TeamSeasonGameOut): boolean {
  return game.team_score !== 0 || game.opponent_score !== 0;
}

/**
 * A game's result card, its control's content: the matchup in short names
 * with the selected team first, a W or L chip (its word in hidden text, so
 * the result is never the chip's look alone), then the score from the
 * selected team's side and the game's label, else its type.
 */
function ResultCard({
  game,
  teamName,
}: {
  game: TeamSeasonGameOut;
  teamName: string;
}) {
  const label = [game.label, game.sub_label]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");

  return (
    <>
      <span className={styles.matchup}>
        {teamShortName(teamName)} {game.is_home ? "vs" : "at"}{" "}
        {teamShortName(game.opponent.name)}
      </span>
      {isPlayed(game) ? (
        <>
          <span
            className={game.won ? styles.win : styles.loss}
            aria-hidden="true"
          >
            {game.won ? "W" : "L"}
          </span>
          <VisuallyHidden>, {game.won ? "Won" : "Lost"}, </VisuallyHidden>
        </>
      ) : (
        <VisuallyHidden>, Not played yet, </VisuallyHidden>
      )}
      <span className={styles.resultLine}>
        <span className={styles.resultScore}>
          {game.team_score}–{game.opponent_score}
        </span>{" "}
        <span>{label || formatGameType(game.game_type)}</span>
      </span>
    </>
  );
}

/** The chart's frame, in viewBox units: the plot, its baseline, a bar's cap. */
const CHART = { left: 64, right: 592, top: 8, base: 92, bottom: 176 };

/**
 * The team's record after each game, oldest first: a wins bar rising above
 * the baseline and a losses bar falling below it, each as tall as its count
 * on one scale (0 to the larger final count). Position, not colour, carries
 * the meaning, and the axis says which side is which. Its `games` are the
 * played ones only. The x-axis names each
 * month at its first game. Its values are the table in the <details> below.
 */
function RecordChart({
  games,
  teamName,
  season,
}: {
  games: TeamSeasonGameOut[];
  teamName: string;
  season: string;
}) {
  const { left, right, top, base, bottom } = CHART;
  const ordered = [...games].sort(
    (a, b) => a.date.localeCompare(b.date) || a.game_id - b.game_id,
  );
  let wins = 0;
  let losses = 0;
  const rows = ordered.map((game) => {
    if (game.won) wins += 1;
    else losses += 1;
    return { game, wins, losses, month: format(parseISO(game.date), "MMM") };
  });
  const scale = Math.max(wins, losses, 1);
  const slot = (right - left) / rows.length;
  const width = Math.min(24, Math.max(1, slot * 0.7));
  const height = (count: number) => (count / scale) * (base - top);

  // A month's name at its first game, unless it would crowd the last one.
  const months: { key: number; x: number; month: string }[] = [];
  rows.forEach((row, index) => {
    const x = left + slot * index;
    const last = months[months.length - 1];
    if (
      rows[index - 1]?.game.date.slice(0, 7) !== row.game.date.slice(0, 7) &&
      (last === undefined || x - last.x >= 36)
    )
      months.push({ key: row.game.game_id, x, month: row.month });
  });

  return (
    <div className={styles.chart}>
      <svg
        className={styles.chartSvg}
        viewBox="0 0 600 200"
        role="img"
        aria-label={`Wins and losses after each game, ${teamName}, ${season}`}
      >
        <text className={styles.chartAxis} x={0} y={top + 12}>
          Wins
        </text>
        <text className={styles.chartAxis} x={0} y={bottom}>
          Losses
        </text>
        {rows.map((row, index) => {
          const x = left + slot * index + (slot - width) / 2;
          return (
            <g key={row.game.game_id}>
              <rect
                className={styles.chartWin}
                x={x}
                y={base - height(row.wins)}
                width={width}
                height={height(row.wins)}
              />
              <rect
                className={styles.chartLoss}
                x={x}
                y={base}
                width={width}
                height={height(row.losses)}
              />
            </g>
          );
        })}
        <line
          className={styles.chartZero}
          x1={left}
          x2={right}
          y1={base}
          y2={base}
        />
        {months.map(({ key, x, month }) => (
          <text key={key} className={styles.chartAxis} x={x} y={196}>
            {month}
          </text>
        ))}
      </svg>
      <details className={styles.chartTable}>
        <summary>Record after each game</summary>
        <ScrollTable caption={`Record after each game, ${teamName}, ${season}`}>
          <thead>
            <tr>
              <ColumnHeader label="Game" />
              <ColumnHeader label="Month" name />
              <ColumnHeader label="Result" name />
              <ColumnHeader label="Record" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.game.game_id}>
                <th scope="row">{index + 1}</th>
                <td className={styles.name}>{row.month}</td>
                <td className={styles.name}>
                  <abbr title={row.game.won ? "Won" : "Lost"}>
                    {row.game.won ? "W" : "L"}
                  </abbr>
                </td>
                <td>{formatRecord(row.wins, row.losses)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </details>
    </div>
  );
}
