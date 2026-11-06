import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { InlineAlert } from "../../components/ui/InlineAlert";
import { Skeleton } from "../../components/ui/Skeleton";
import { TeamIcon } from "../../components/ui/TeamIcon";
import { useDetailLinkState } from "../../routes/modal-flow";
import { apiClient } from "../../api/client";
import type { RecentGameOut } from "./api";
import { teamShortName } from "./format";
import styles from "./RecentGames.module.css";

/**
 * Only mounted with the home rail; ranks and ordering belong to the API.
 * FRONTEND-037: each game is a compact scoreboard card, away above home, each
 * side its short name, overall record and score; the loser's side is muted
 * and the winner's named in hidden text, so the result is never colour alone.
 * The link carries the game's season to the game page's team links.
 */
export function RecentGames() {
  const state = useDetailLinkState();
  const query = useQuery({
    queryKey: ["events", "games", "recent"],
    queryFn: fetchRecentGames,
    staleTime: 300_000,
  });
  if (query.isSuccess && query.data.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="recent-games-heading">
      <h2 id="recent-games-heading">Recent games</h2>
      {query.isPending ? (
        <div role="status" aria-label="Loading recent games">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className={styles.row}>
              <Skeleton variant="line" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <>
          <InlineAlert>Recent games could not be loaded.</InlineAlert>
          <button type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
        </>
      ) : (
        <ul>
          {query.data.map((game) => (
            <li key={game.id}>
              <Link
                className={styles.row}
                to={`/games/${game.id}?${new URLSearchParams({ season: game.season }).toString()}`}
                state={state}
              >
                <Side
                  team={game.away_team}
                  record={game.away_record}
                  score={game.away_score}
                  other={game.home_score}
                />
                <Side
                  team={game.home_team}
                  record={game.home_record}
                  score={game.home_score}
                  other={game.away_score}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One team's line of a card: icon, short name, (wins-losses), score. */
function Side({
  team,
  record,
  score,
  other,
}: {
  team: RecentGameOut["home_team"];
  record: RecentGameOut["home_record"];
  score: number;
  other: number;
}) {
  const result =
    score > other ? styles.winner : score < other ? styles.loser : undefined;
  return (
    <span
      className={
        result === undefined ? styles.side : `${styles.side} ${result}`
      }
    >
      <TeamIcon abbreviation={team.abbreviation} size="sm" />{" "}
      <span className={styles.name}>
        {teamShortName(team.name)}{" "}
        <span className={styles.record}>
          ({record.wins}-{record.losses})
        </span>
      </span>{" "}
      <span className={styles.score}>
        {score}
        {/*
          base.css's hidden-text class directly, not the VisuallyHidden
          wrapper: importing it here folds its shared chunk into another.
        */}
        {score > other ? (
          <span className="visually-hidden">, winner</span>
        ) : null}
      </span>
    </span>
  );
}

/** Kept in this lazy feature so the game page does not gain a shared API chunk. */
async function fetchRecentGames(): Promise<RecentGameOut[]> {
  const { data, response } = await apiClient.GET("/events/games/recent");
  if (!response.ok || data === undefined) {
    throw new Error(`GET /events/games/recent answered ${response.status}`);
  }
  return data;
}
