import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { GameScore } from "../../components/ui/GameScore";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { Skeleton } from "../../components/ui/Skeleton";
import { TeamIcon } from "../../components/ui/TeamIcon";
import { useDetailLinkState } from "../../routes/modal-flow";
import { apiClient } from "../../api/client";
import type { RecentGameOut } from "./api";
import styles from "./RecentGames.module.css";

/** Only mounted with the home rail; ranks and ordering belong to the API. */
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
                to={`/games/${game.id}`}
                state={state}
                aria-label={`${game.home_team.name} ${game.home_score}, ${game.away_team.name} ${game.away_score}, Final`}
              >
                <div className={styles.teams}>
                  {[game.home_team, game.away_team].map((team) => (
                    <span key={team.id}>
                      <TeamIcon abbreviation={team.abbreviation} size="sm" />
                      <span>{team.abbreviation}</span>
                    </span>
                  ))}
                </div>
                <GameScore
                  variant="row"
                  homeScore={game.home_score}
                  awayScore={game.away_score}
                  status="FT"
                />
              </Link>
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
