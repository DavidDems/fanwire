import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import { formatGameDate } from "../games/format";
import {
  fetchTeamSeason,
  teamSeasonKey,
  type TeamOut,
  type TeamSeasonGameOut,
  type TeamSeasonOut,
} from "./api";
import { formatGameType, formatRecord } from "./labels";
import { gameHref, teamHref } from "./links";
import { ColumnHeader, ScrollTable } from "./ScrollTable";
import styles from "./Stats.module.css";

export interface TeamSeasonViewProps {
  teamId: number;
  season: string;
  seasonInUrl: string | null;
  teams: TeamOut[] | undefined;
}

/**
 * One team's season, in place of the league view: its record and home and
 * away splits, then its games from its own side, newest first, from
 * `GET /events/teams/{id}/seasons/{season}`.
 */
export function TeamSeasonView({
  teamId,
  season,
  seasonInUrl,
  teams,
}: TeamSeasonViewProps) {
  const teamSeason = useQuery({
    queryKey: teamSeasonKey(teamId, season),
    queryFn: () => fetchTeamSeason(teamId, season),
  });
  const known = teams?.find((team) => team.id === teamId);

  if (teamSeason.isPending)
    return <StatusLine>Loading the team’s season…</StatusLine>;
  if (teamSeason.isError)
    return (
      <InlineAlert>
        We could not load this team’s season just now. Please try again.
      </InlineAlert>
    );
  if (teamSeason.data === null)
    return (
      <EmptyState>
        There is no {season} season for {known?.name ?? "that team"}.
      </EmptyState>
    );

  return <TeamSeason data={teamSeason.data} seasonInUrl={seasonInUrl} />;
}

function TeamSeason({
  data,
  seasonInUrl,
}: {
  data: TeamSeasonOut;
  seasonInUrl: string | null;
}) {
  const { team, record, season, games } = data;
  const headingId = `stats-team-${team.id}`;

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId}>
        {team.name}, {season}
      </h2>
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
                seasonInUrl={seasonInUrl}
              />
            ))}
          </tbody>
        </ScrollTable>
      )}
    </section>
  );
}

function GameRow({
  game,
  seasonInUrl,
}: {
  game: TeamSeasonGameOut;
  seasonInUrl: string | null;
}) {
  const label = [game.label, game.sub_label]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");

  return (
    <tr>
      <th scope="row" className={styles.name}>
        <Link to={gameHref(game.game_id)}>{formatGameDate(game.date)}</Link>
      </th>
      <td className={styles.name}>
        {game.is_home ? "vs " : "at "}
        <Link to={teamHref(game.opponent.id, seasonInUrl)}>
          {game.opponent.name}
        </Link>
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
