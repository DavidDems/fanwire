import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useState } from "react";

import { Field, describeField } from "../../components/FormField";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { GameScore } from "../../components/ui/GameScore";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import styles from "./Search.module.css";
import {
  GAME_FILTERS_KEY,
  NO_GAME_FILTERS,
  TEAMS_KEY,
  fetchGameFilters,
  fetchGamesPage,
  fetchTeams,
  gamesKey,
  hasGameFilter,
  type GameFilters,
  type GameOut,
  type TeamOut,
} from "./api";

/**
 * A search result is a finished game: `GameOut` carries no status column, and
 * `GET /search/games` reads historical data, so every row is a final
 * (`components.md` §4).
 */
const FINAL = "FT";

/**
 * The sports-data search: season, team and position dropdowns over
 * `GET /search/games`, and the games they match.
 *
 * **There is no text input here, of any kind.** "No free-text search for sports
 * data" is a business rule (`business-rules.md`, carried into [[0x07-search]]),
 * and a type-ahead box "just to narrow the team list" is a text input — so every
 * control is a native `<select>`, and `GameFilter.test.tsx` holds it to that.
 *
 * **Changing a filter asks the server again.** The filters are the query key,
 * so each combination is its own request and its own cache entry; nothing here
 * narrows the previous answer on the client. Until at least one filter is set
 * there is nothing to ask for, and nothing is asked.
 *
 * The options come from the API rather than from a list kept here: seasons and
 * positions from `GET /search/games/filters`, teams from `GET /events/teams`
 * (deliberately not duplicated into the filters response, [[0x07-search]]).
 */
export function GameFilter() {
  const [filters, setFilters] = useState<GameFilters>(NO_GAME_FILTERS);

  const options = useQuery({
    queryKey: GAME_FILTERS_KEY,
    queryFn: fetchGameFilters,
  });
  const teams = useQuery({ queryKey: TEAMS_KEY, queryFn: fetchTeams });
  const teamsById = new Map(
    (teams.data ?? []).map((team) => [team.id, team] as const),
  );

  const filtering = hasGameFilter(filters);
  const games = useInfiniteQuery({
    queryKey: gamesKey(filters),
    queryFn: ({ pageParam }) => fetchGamesPage(filters, pageParam),
    initialPageParam: 0,
    // `next_offset` straight through: `null` is react-query's own "no further page".
    getNextPageParam: (lastPage) => lastPage.next_offset,
    enabled: filtering,
  });
  const items = filtering
    ? (games.data?.pages ?? []).flatMap((page) => page.items)
    : [];

  function choose(name: keyof GameFilters, value: string): void {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  return (
    <section className={styles.section} aria-labelledby="search-games">
      <h2 id="search-games">Games</h2>

      <Card className={styles.filters}>
        {options.isPending || teams.isPending ? (
          <StatusLine>Loading the filters…</StatusLine>
        ) : null}
        {options.isError ? (
          <InlineAlert>
            We could not load the seasons and positions.
          </InlineAlert>
        ) : null}
        {teams.isError ? (
          <InlineAlert>We could not load the list of teams.</InlineAlert>
        ) : null}

        <Field id="game-filter-season" label="Season">
          <select
            {...describeField("game-filter-season")}
            name="season"
            value={filters.season}
            onChange={(event) => {
              choose("season", event.target.value);
            }}
          >
            <option value="">Any season</option>
            {(options.data?.seasons ?? []).map((season) => (
              <option key={season} value={season}>
                {season}
              </option>
            ))}
          </select>
        </Field>

        <Field id="game-filter-team" label="Team">
          <select
            {...describeField("game-filter-team")}
            name="team"
            value={filters.teamId}
            onChange={(event) => {
              choose("teamId", event.target.value);
            }}
          >
            <option value="">Any team</option>
            {(teams.data ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="game-filter-position" label="Position">
          <select
            {...describeField("game-filter-position")}
            name="position"
            value={filters.position}
            onChange={(event) => {
              choose("position", event.target.value);
            }}
          >
            <option value="">Any position</option>
            {(options.data?.positions ?? []).map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      {filtering && games.isPending ? (
        <StatusLine>Finding games…</StatusLine>
      ) : null}
      {filtering && games.isError ? (
        <InlineAlert>
          We could not search the games just now. Please try again.
        </InlineAlert>
      ) : null}
      {filtering && games.isSuccess && items.length === 0 ? (
        <EmptyState>
          No games found for {describeFilters(filters, teamsById)}.
        </EmptyState>
      ) : null}

      {items.length === 0 ? null : (
        <Card>
          <ul className={styles.list}>
            {items.map((game) => (
              <GameRow key={game.id} game={game} teamsById={teamsById} />
            ))}
          </ul>
        </Card>
      )}

      {!filtering || !games.hasNextPage ? null : (
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

/**
 * One game: both teams by abbreviation, home first as `GameScore` orders its
 * figures, then the score block itself. Text only — no logo and no team colour
 * (`components.md` §4, Team identity).
 */
function GameRow({
  game,
  teamsById,
}: {
  game: GameOut;
  teamsById: ReadonlyMap<number, TeamOut>;
}) {
  return (
    <li className={styles.row}>
      <div className={styles.body}>
        <p className={styles.teams}>
          <Badge variant="outline">
            {teamLabel(game.home_team_id, teamsById)}
          </Badge>
          <span>vs</span>
          <Badge variant="outline">
            {teamLabel(game.away_team_id, teamsById)}
          </Badge>
        </p>
        <p className={styles.muted}>
          <time dateTime={game.date}>
            {format(parseISO(game.date), "d MMM yyyy")}
          </time>
        </p>
        <GameScore
          variant="row"
          homeScore={game.home_score}
          awayScore={game.away_score}
          status={FINAL}
        />
      </div>
    </li>
  );
}

/**
 * A team's abbreviation, or its id while the team list is still loading (or
 * failed) — a row is never held back for a label.
 */
function teamLabel(
  teamId: number,
  teamsById: ReadonlyMap<number, TeamOut>,
): string {
  return teamsById.get(teamId)?.abbreviation ?? `Team ${teamId}`;
}

/** The filters that were set, in words, for the no-results line. */
function describeFilters(
  filters: GameFilters,
  teamsById: ReadonlyMap<number, TeamOut>,
): string {
  return [
    filters.season === "" ? null : `season ${filters.season}`,
    filters.teamId === "" ? null : teamLabel(Number(filters.teamId), teamsById),
    filters.position === "" ? null : `position ${filters.position}`,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
}
