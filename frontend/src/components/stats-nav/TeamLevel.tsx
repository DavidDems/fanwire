import { useQuery, useQueryClient } from "@tanstack/react-query";

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
}: {
  level: TeamLevelData;
  adapter: StatsNavAdapter;
  onTeam: (teamId: number) => void;
}) {
  const teamSeason = useQuery(teamSeasonQuery(level.teamId, level.season));

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
    <TeamSeason data={teamSeason.data} adapter={adapter} onTeam={onTeam} />
  );
}

function TeamSeason({
  data,
  adapter,
  onTeam,
}: {
  data: TeamSeasonOut;
  adapter: StatsNavAdapter;
  onTeam: (teamId: number) => void;
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
              />
            ))}
          </tbody>
        </ScrollTable>
      )}
    </>
  );
}

function GameRow({
  game,
  season,
  adapter,
  onTeam,
}: {
  game: TeamSeasonGameOut;
  season: string;
  adapter: StatsNavAdapter;
  onTeam: (teamId: number) => void;
}) {
  const label = [game.label, game.sub_label]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");

  return (
    <tr>
      <th scope="row" className={styles.name}>
        {adapter.gameLink(game.game_id, formatGameDate(game.date))}
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
