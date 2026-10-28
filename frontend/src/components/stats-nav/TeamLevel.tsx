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
import { formatGameDate } from "../../features/games/format";
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
 * The team season level: the team's record and home and away splits, then
 * its games from its own side, newest first (the API's order). An opponent
 * opens its own team level in this one's place.
 */
export function TeamLevel({
  level,
  adapter,
  onTeam,
  onGame,
}: {
  level: TeamLevelData;
  adapter: StatsNavAdapter;
  onTeam: (teamId: number) => void;
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
      <TeamSeason
        data={teamSeason.data}
        adapter={adapter}
        onTeam={onTeam}
        onGame={onGame}
      />
    </>
  );
}

function TeamSeason({
  data,
  adapter,
  onTeam,
  onGame,
}: {
  data: TeamSeasonOut;
  adapter: StatsNavAdapter;
  onTeam: (teamId: number) => void;
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

      <TeamMarginChart games={games} teamName={team.name} season={season} />

      {games.length === 0 ? (
        <EmptyState>
          {team.name} played no games in {season}.
        </EmptyState>
      ) : (
        <ScrollTable caption={`${team.name} games, ${season}, newest first`}>
          <thead>
            <tr>
              <ColumnHeader label="Date" name />
              <ColumnHeader label="Opponent" name />
              <ColumnHeader label="Result" name />
              <ColumnHeader label="Game" name />
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <GameRow
                key={game.game_id}
                game={game}
                season={season}
                adapter={adapter}
                onTeam={onTeam}
                onGame={onGame}
              />
            ))}
          </tbody>
        </ScrollTable>
      )}
    </>
  );
}

function TeamMarginChart({
  games,
  teamName,
  season,
}: {
  games: TeamSeasonGameOut[];
  teamName: string;
  season: string;
}) {
  const plotted = [...games].sort(
    (a, b) => a.date.localeCompare(b.date) || a.game_id - b.game_id,
  );
  const margins = plotted.map((game) => game.team_score - game.opponent_score);
  const bound = Math.max(5, Math.ceil(Math.max(0, ...margins.map(Math.abs)) / 5) * 5);
  const ticks = Array.from({ length: (bound * 2) / 5 + 1 }, (_, index) => -bound + index * 5);
  const left = 48;
  const right = 584;
  const top = 12;
  const bottom = 142;
  const points = plotted.map((game, index) => ({
    game,
    margin: margins[index],
    x: plotted.length < 2 ? (left + right) / 2 : left + ((right - left) * index) / (plotted.length - 1),
    y: top + ((bound - margins[index]!) / (2 * bound)) * (bottom - top),
  }));
  const labelEvery = Math.max(1, Math.ceil((points.length - 1) / 6));
  const dateLabels = points.filter(
    (_, index) =>
      index === 0 || index === points.length - 1 || index % labelEvery === 0,
  );

  return (
    <div className={styles.chart}>
      {points.length >= 2 ? (
        <svg
          className={styles.chartSvg}
          viewBox="0 0 600 184"
          role="img"
          aria-label={`Point margin for ${teamName}, ${season}`}
        >
          {ticks.map((tick) => {
            const y = top + ((bound - tick) / (2 * bound)) * (bottom - top);
            return (
              <g key={tick}>
                <line className={tick === 0 ? styles.chartZero : styles.chartGrid} x1={left} x2={right} y1={y} y2={y} />
                <text className={styles.chartAxis} x={left - 8} y={y + 4} textAnchor="end"> {tick} </text>
              </g>
            );
          })}
          <polyline
            className={styles.chartLine}
            points={points.map(({ x, y }) => `${x},${y}`).join(" ")}
          />
          {points.map(({ x, y }, index) => (
            <circle key={index} className={styles.chartPoint} cx={0} cy={0} r={4} transform={`translate(${x} ${y})`} />
          ))}
          {dateLabels.map(({ game, x }) => (
            <text key={game.game_id} className={styles.chartAxis} x={x} y={166} textAnchor="middle">{format(parseISO(game.date), "MMM d")}</text>
          ))}
        </svg>
      ) : (
        <p className={styles.chartNote}>
          {points.length === 0
            ? `There are no games for ${teamName} in ${season}.`
            : "At least two games are needed to draw a line."}
        </p>
      )}
      <ScrollTable caption={`Point margin for ${teamName}, ${season} (all ${plotted.length} games)`}>
        <thead>
          <tr>
            <ColumnHeader label="Date" name />
            <ColumnHeader label="Opponent" name />
            <ColumnHeader label="Result" name />
            <ColumnHeader label="Margin" />
          </tr>
        </thead>
        <tbody>
          {points.map(({ game, margin }) => (
            <tr key={game.game_id}>
              <th scope="row" className={styles.name}>{formatGameDate(game.date)}</th>
              <td className={styles.name}>{game.opponent.name}</td>
              <td className={styles.name}>
                <abbr title={game.won ? "Won" : "Lost"}>
                  {game.won ? "W" : "L"}
                </abbr>
              </td>
              <td>{margin > 0 ? `+${margin}` : String(margin)}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </div>
  );
}

function GameRow({
  game,
  season,
  adapter,
  onTeam,
  onGame,
}: {
  game: TeamSeasonGameOut;
  season: string;
  adapter: StatsNavAdapter;
  onTeam: (teamId: number) => void;
  onGame?: (gameId: number) => void;
}) {
  const label = [game.label, game.sub_label]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");

  return (
    <tr>
      <th scope="row" className={styles.name}>
        {onGame ? (
          <LevelLink
            level={{ kind: "game", gameId: game.game_id }}
            adapter={adapter}
            onGo={() => onGame(game.game_id)}
          >
            {formatGameDate(game.date)}
          </LevelLink>
        ) : (
          adapter.gameLink(game.game_id, formatGameDate(game.date))
        )}
      </th>
      <td className={styles.name}>
        {game.is_home ? "vs " : "at "}
        <LevelLink
          level={{ kind: "team", season, teamId: game.opponent.id }}
          adapter={adapter}
          onGo={() => onTeam(game.opponent.id)}
        >
          {game.opponent.name}
        </LevelLink>
      </td>
      <td className={styles.name}>
        {/* The result in a letter and a word, never by colour alone. */}
        <abbr title={game.won ? "Won" : "Lost"}>
          {game.won ? "W" : "L"}
        </abbr>{" "}
        {`${game.team_score}-${game.opponent_score}`}
      </td>
      <td className={styles.name}>{label || formatGameType(game.game_type)}</td>
    </tr>
  );
}
