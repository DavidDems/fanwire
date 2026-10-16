import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import {
  formatAverage,
  formatGameDate,
  formatPercentage,
} from "../games/format";
import {
  GAMES_PAGE_SIZE,
  championKey,
  fetchChampion,
  fetchLeaders,
  fetchSeasonGamesPage,
  fetchStandings,
  leadersKey,
  nextOffset,
  seasonGamesKey,
  standingsKey,
  type LeaderStat,
  type StandingRowOut,
  type StandingsOut,
  type TeamOut,
} from "./api";
import { formatGameType } from "./labels";
import { gameHref, playerHref, teamHref } from "./links";
import { ColumnHeader, ScrollTable } from "./ScrollTable";
import styles from "./Stats.module.css";

export interface LeagueViewProps {
  season: string;
  /** The season the address carries, or `null` for the default: links keep it. */
  seasonInUrl: string | null;
  /** `GET /events/teams`, to name the teams of a game; `undefined` while loading. */
  teams: TeamOut[] | undefined;
}

/**
 * The league view of one season: four sections, each a region named by its
 * `h2`, each with its own read, so one failing never hides the others.
 */
export function LeagueView({ season, seasonInUrl, teams }: LeagueViewProps) {
  return (
    <>
      <ChampionSection season={season} />
      <StandingsSection season={season} seasonInUrl={seasonInUrl} />
      <LeadersSection season={season} />
      <GamesSection season={season} seasonInUrl={seasonInUrl} teams={teams} />
    </>
  );
}

function ChampionSection({ season }: { season: string }) {
  const champion = useQuery({
    queryKey: championKey(season),
    queryFn: () => fetchChampion(season),
  });
  const data = champion.data;

  return (
    <section className={styles.section} aria-labelledby="stats-champion">
      <h2 id="stats-champion">Champion</h2>
      {champion.isPending ? (
        <StatusLine>Loading the champion…</StatusLine>
      ) : null}
      {champion.isError ? (
        <InlineAlert>
          We could not load this season’s champion just now. Please try again.
        </InlineAlert>
      ) : null}
      {data === undefined ? null : data.champion === null ? (
        <EmptyState>The {season} season has no champion yet.</EmptyState>
      ) : (
        <p className={styles.champion}>
          <span className={styles.championName}>{data.champion.name}</span>
          {data.runner_up === null ? null : (
            <>
              {" beat "}
              {data.runner_up.name}
            </>
          )}
          {data.result === null ? null : <> in the Finals, {data.result}</>}
          {"."}
        </p>
      )}
    </section>
  );
}

/** Win percentage, then wins, then name: the API's conference order. */
function conferenceOrder(a: StandingRowOut, b: StandingRowOut): number {
  return (
    b.win_pct - a.win_pct ||
    b.wins - a.wins ||
    a.team.name.localeCompare(b.team.name)
  );
}

function StandingsSection({
  season,
  seasonInUrl,
}: {
  season: string;
  seasonInUrl: string | null;
}) {
  const standings = useQuery({
    queryKey: standingsKey(season),
    queryFn: () => fetchStandings(season),
  });

  return (
    <section className={styles.section} aria-labelledby="stats-standings">
      <h2 id="stats-standings">Standings</h2>
      {standings.isPending ? (
        <StatusLine>Loading the standings…</StatusLine>
      ) : null}
      {standings.isError ? (
        <InlineAlert>
          We could not load the standings just now. Please try again.
        </InlineAlert>
      ) : null}
      {standings.data === undefined ? null : (
        <StandingsTables standings={standings.data} seasonInUrl={seasonInUrl} />
      )}
    </section>
  );
}

function StandingsTables({
  standings,
  seasonInUrl,
}: {
  standings: StandingsOut;
  seasonInUrl: string | null;
}) {
  if (standings.conferences.length === 0)
    return (
      <EmptyState>
        There are no standings for {standings.season} yet.
      </EmptyState>
    );

  return (
    <>
      {standings.conferences.map((conference) => {
        // One table per conference, in the conference's own order: the API
        // groups by division, and a table that concatenated the divisions
        // would rank a division winner above a better record.
        const rows = conference.divisions
          .flatMap((division) =>
            division.teams.map((row) => ({ row, division: division.division })),
          )
          .sort((a, b) => conferenceOrder(a.row, b.row));
        return (
          <ScrollTable
            key={conference.conference}
            caption={`${conference.conference} Conference`}
          >
            <thead>
              <tr>
                <ColumnHeader label="Team" name />
                <ColumnHeader label="W" title="Wins" />
                <ColumnHeader label="L" title="Losses" />
                <ColumnHeader label="PCT" title="Win percentage" />
                <ColumnHeader label="GB" title="Games behind" />
                <ColumnHeader label="Home" />
                <ColumnHeader label="Away" />
                <ColumnHeader label="Division" name />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, division }) => (
                <tr key={row.team.id}>
                  <th scope="row" className={styles.name}>
                    <Link to={teamHref(row.team.id, seasonInUrl)}>
                      {row.team.name}
                    </Link>
                  </th>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td>{formatPercentage(row.win_pct)}</td>
                  <td>{row.games_behind === 0 ? "–" : row.games_behind}</td>
                  <td>{`${row.home_wins}-${row.home_losses}`}</td>
                  <td>{`${row.away_wins}-${row.away_losses}`}</td>
                  <td className={styles.name}>{division}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        );
      })}
      <p className={styles.note}>Ties broken by: {standings.tie_break}.</p>
    </>
  );
}

const BOARDS: ReadonlyArray<readonly [LeaderStat, string, string]> = [
  ["points", "Points per game", "PPG"],
  ["rebounds", "Rebounds per game", "RPG"],
  ["assists", "Assists per game", "APG"],
];

function LeadersSection({ season }: { season: string }) {
  // The rule is the same for every board of a season; it is read from the
  // first board, which is fetched (and cached) by its own table below.
  const points = useQuery({
    queryKey: leadersKey(season, "points"),
    queryFn: () => fetchLeaders(season, "points"),
  });

  return (
    <section className={styles.section} aria-labelledby="stats-leaders">
      <h2 id="stats-leaders">Leaders</h2>
      {points.data === undefined ? null : (
        <p className={styles.note}>
          Regular season. To qualify, a player needs at least {points.data.rule}
          .
        </p>
      )}
      {BOARDS.map(([stat, caption, abbreviation]) => (
        <LeaderBoard
          key={stat}
          season={season}
          stat={stat}
          caption={caption}
          abbreviation={abbreviation}
        />
      ))}
    </section>
  );
}

function LeaderBoard({
  season,
  stat,
  caption,
  abbreviation,
}: {
  season: string;
  stat: LeaderStat;
  caption: string;
  abbreviation: string;
}) {
  const board = useQuery({
    queryKey: leadersKey(season, stat),
    queryFn: () => fetchLeaders(season, stat),
  });

  if (board.isPending)
    return (
      <StatusLine>Loading the {caption.toLowerCase()} leaders…</StatusLine>
    );
  if (board.isError)
    return (
      <InlineAlert>
        We could not load the {caption.toLowerCase()} leaders just now.
      </InlineAlert>
    );
  if (board.data.leaders.length === 0)
    return (
      <EmptyState>
        No player qualifies for {caption.toLowerCase()} yet.
      </EmptyState>
    );

  return (
    <ScrollTable caption={caption}>
      <thead>
        <tr>
          <ColumnHeader label="#" title="Rank" />
          <ColumnHeader label="Player" name />
          <ColumnHeader label="Team" name />
          <ColumnHeader label="GP" title="Games played" />
          <ColumnHeader label={abbreviation} title={caption} />
        </tr>
      </thead>
      <tbody>
        {board.data.leaders.map((leader, index) => (
          <tr key={leader.player_id}>
            <td>{index + 1}</td>
            <th scope="row" className={styles.name}>
              <Link to={playerHref(leader.player_id)}>
                {`${leader.first_name} ${leader.last_name}`.trim()}
              </Link>
            </th>
            <td className={styles.name}>{leader.teams.join(", ")}</td>
            <td>{leader.games_played}</td>
            <td className={styles.figure}>{formatAverage(leader.average)}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

function GamesSection({ season, seasonInUrl, teams }: LeagueViewProps) {
  const games = useInfiniteQuery({
    queryKey: seasonGamesKey(season),
    queryFn: ({ pageParam }) => fetchSeasonGamesPage(season, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) =>
      nextOffset(lastPage, lastOffset, GAMES_PAGE_SIZE),
  });
  const items = (games.data?.pages ?? []).flat();
  const byId = new Map((teams ?? []).map((team) => [team.id, team]));

  function teamCell(teamId: number) {
    const team = byId.get(teamId);
    return (
      <td className={styles.name}>
        {team === undefined ? (
          `Team ${teamId}`
        ) : (
          <Link to={teamHref(team.id, seasonInUrl)}>{team.name}</Link>
        )}
      </td>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="stats-games">
      <h2 id="stats-games">Games</h2>
      {games.isPending ? <StatusLine>Loading the games…</StatusLine> : null}
      {games.isError ? (
        <InlineAlert>
          We could not load this season’s games just now. Please try again.
        </InlineAlert>
      ) : null}
      {games.isSuccess && items.length === 0 ? (
        <EmptyState>There are no games for {season} yet.</EmptyState>
      ) : null}
      {items.length === 0 ? null : (
        <ScrollTable caption={`${season} games, newest first`}>
          <thead>
            <tr>
              <ColumnHeader label="Date" name />
              <ColumnHeader label="Away" name />
              <ColumnHeader label="PTS" title="Away points" />
              <ColumnHeader label="Home" name />
              <ColumnHeader label="PTS" title="Home points" />
              <ColumnHeader label="Type" name />
            </tr>
          </thead>
          <tbody>
            {items.map((game) => (
              <tr key={game.id}>
                <th scope="row" className={styles.name}>
                  <Link to={gameHref(game.id)}>
                    {formatGameDate(game.date)}
                  </Link>
                </th>
                {teamCell(game.away_team_id)}
                <td className={styles.figure}>{game.away_score}</td>
                {teamCell(game.home_team_id)}
                <td className={styles.figure}>{game.home_score}</td>
                <td className={styles.name}>
                  {formatGameType(game.game_type)}
                </td>
              </tr>
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
