import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Field, describeField } from "../../components/FormField";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import {
  PLAYERS_PAGE_SIZE,
  fetchPlayersPage,
  nextOffset,
  playerSearchKey,
  type PlayerListItemOut,
} from "./api";
import { playerHref } from "./links";
import styles from "./Stats.module.css";

const BOX_ID = "stats-player-search";
/** How long the box waits after the last keystroke before it searches. */
const SEARCH_DEBOUNCE_MS = 250;
/** A cap on the text, as the Search page has, so an address stays short. */
const MAX_QUERY_LENGTH = 100;

/**
 * `/stats/players`: a small player search. As the user types, the trimmed
 * text goes into the address as `?q=` after a short pause, and the address is
 * what is searched, so a reload or a shared link searches again. An empty box
 * searches nothing.
 *
 * Results page apart with an infinite query over offsets, as the Search page
 * does; `GET /events/players` answers a bare list, so a full page is the only
 * sign another may follow.
 */
export function PlayersTab() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const [text, setText] = useState(q);

  // Back, forward or a link changes `?q=` under the box: show what is being
  // searched for. Adjusted during render; the box's own pending text is kept
  // when it already says the same thing.
  const [shownFor, setShownFor] = useState(q);
  if (shownFor !== q) {
    setShownFor(q);
    if (text.trim() !== q) setText(q);
  }

  useEffect(() => {
    const wanted = text.trim();
    if (wanted === q) return;
    const timer = setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (wanted === "") next.delete("q");
          else next.set("q", wanted);
          return next;
        },
        // Each pause is not a page in the history.
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, q, setParams]);

  return (
    <div className={styles.tab}>
      <Card>
        <div role="search" className={styles.controls}>
          <Field id={BOX_ID} label="Search players">
            <input
              {...describeField(BOX_ID)}
              type="search"
              autoComplete="off"
              maxLength={MAX_QUERY_LENGTH}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
        </div>
      </Card>
      {q === "" ? null : <PlayerResults q={q} />}
    </div>
  );
}

function PlayerResults({ q }: { q: string }) {
  const players = useInfiniteQuery({
    queryKey: playerSearchKey(q),
    queryFn: ({ pageParam }) => fetchPlayersPage(q, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) =>
      nextOffset(lastPage, lastOffset, PLAYERS_PAGE_SIZE),
  });
  const items = (players.data?.pages ?? []).flat();

  return (
    <section className={styles.section} aria-labelledby="stats-players">
      <h2 id="stats-players">Results</h2>
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
              <PlayerItem key={player.id} player={player} />
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

function PlayerItem({ player }: { player: PlayerListItemOut }) {
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
    <li className={styles.row}>
      <Link to={playerHref(player.id)} className={styles.rowTitle}>
        {name}
      </Link>{" "}
      {details.length === 0 ? null : (
        <span className={styles.muted}>{details.join(" · ")}</span>
      )}
    </li>
  );
}
