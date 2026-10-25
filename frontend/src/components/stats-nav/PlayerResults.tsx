import { useInfiniteQuery } from "@tanstack/react-query";
import { useId } from "react";

import {
  PLAYERS_PAGE_SIZE,
  fetchPlayersPage,
  nextOffset,
  playerSearchKey,
  type PlayerListItemOut,
} from "../../api/stats";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { InlineAlert } from "../ui/InlineAlert";
import { StatusLine } from "../ui/StatusLine";
import styles from "./StatsNav.module.css";
import type { StatsNavAdapter } from "./types";

/**
 * The navigator's player-results view: the players matching a non-empty `q`,
 * in the API's order, each linked through `adapter.playerLink`. Results page
 * apart with an infinite query over offsets; `GET /events/players` answers a
 * bare list, so a full page is the only sign another may follow.
 */
export function PlayerResults({
  q,
  adapter,
}: {
  q: string;
  adapter: StatsNavAdapter;
}) {
  const id = useId();
  const players = useInfiniteQuery({
    queryKey: playerSearchKey(q),
    queryFn: ({ pageParam }) => fetchPlayersPage(q, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) =>
      nextOffset(lastPage, lastOffset, PLAYERS_PAGE_SIZE),
  });
  const items = (players.data?.pages ?? []).flat();

  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id}>Results</h2>
      {players.isPending ? <StatusLine>Searching players…</StatusLine> : null}
      {players.isError ? (
        <InlineAlert>
          We could not search players just now. Please try again.
        </InlineAlert>
      ) : null}
      {players.isSuccess && items.length === 0 ? (
        <EmptyState>No players match “{q}”.</EmptyState>
      ) : null}

      {items.length === 0 ? null : (
        <Card>
          <ul className={styles.list}>
            {items.map((player) => (
              <PlayerItem key={player.id} player={player} adapter={adapter} />
            ))}
          </ul>
        </Card>
      )}

      {!players.hasNextPage ? null : (
        <Button
          type="button"
          variant="secondary"
          size="md"
          className={styles.more}
          onClick={() => void players.fetchNextPage()}
          disabled={players.isFetchingNextPage}
        >
          Load more players
        </Button>
      )}
    </section>
  );
}

function PlayerItem({
  player,
  adapter,
}: {
  player: PlayerListItemOut;
  adapter: StatsNavAdapter;
}) {
  const name = [player.first_name, player.last_name]
    .filter((part) => part !== null && part !== "")
    .join(" ");
  const details = [
    player.position,
    player.latest_team_abbreviation,
    player.first_season === null || player.last_season === null
      ? null
      : player.first_season === player.last_season
        ? player.first_season
        : `${player.first_season} to ${player.last_season}`,
  ].filter((part): part is string => part !== null && part !== "");

  return (
    <li>
      <strong>{adapter.playerLink(player.id, name)}</strong>{" "}
      {details.length === 0 ? null : (
        <span className={styles.muted}>{details.join(" · ")}</span>
      )}
    </li>
  );
}
