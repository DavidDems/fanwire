import { useQuery } from "@tanstack/react-query";

import { InlineAlert } from "../../components/ui/InlineAlert";
import { Skeleton } from "../../components/ui/Skeleton";
import { apiClient } from "../../api/client";
import type { RecentGameOut } from "./api";
import { GameCard } from "./GameCard";
import styles from "./RecentGames.module.css";

/**
 * Only mounted with the home rail; ranks and ordering belong to the API.
 * FRONTEND-037: each game is a compact scoreboard card, away above home, each
 * side its short name, overall record and score; the loser's side is muted
 * and the winner's named in hidden text, so the result is never colour alone.
 * The link carries the game's season to the game page's team links. The card
 * is `GameCard`, shared with the Schedule page since FRONTEND-044.
 */
export function RecentGames() {
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
              <GameCard
                to={`/games/${game.id}?${new URLSearchParams({ season: game.season }).toString()}`}
                away={{
                  team: game.away_team,
                  record: game.away_record,
                  score: game.away_score,
                }}
                home={{
                  team: game.home_team,
                  record: game.home_record,
                  score: game.home_score,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
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
