import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  recordHoldersQuery,
  recordsQuery,
  type RecordCatalogItemOut,
  type RecordHolderOut,
} from "../../api/records";
import { formatGameDate } from "../../features/games/format";
import { CourtScoreboard } from "../visuals/CourtScoreboard";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { InlineAlert } from "../ui/InlineAlert";
import { SearchInput } from "../ui/SearchInput";
import { SegmentedTabs } from "../ui/SegmentedTabs";
import { Skeleton } from "../ui/Skeleton";
import { StatusLine } from "../ui/StatusLine";
import { TeamIcon } from "../ui/TeamIcon";
import { LevelLink } from "./LevelLink";
import { CATEGORY_LABELS, groupTitle, playerName } from "./recordLabels";
import { PAGE_SIZE, barRecords, queryTerms } from "./recordSearch";
import { RecordValue } from "./RecordValue";
import styles from "./StatsNav.module.css";
import type { RecordsBar, StatsLevel, StatsNavAdapter } from "./types";

type RecordsLevelData = Extract<StatsLevel, { kind: "records" }>;

const BARS: { id: RecordsBar; label: string }[] = [
  { id: "top", label: "Top records" },
  { id: "team", label: "Team" },
  { id: "player", label: "Player" },
];

/**
 * How long the box must rest before the count is announced and a new page of
 * holders is asked for, so typing a word costs one read and one announcement.
 */
const SETTLE_MS = 300;

/** What a card knows of its holder: still loading, failed, or its answer. */
type HolderState =
  | { status: "pending" }
  | { status: "failed" }
  | { status: "done"; holder: RecordHolderOut | null };

/**
 * The records level (FRONTEND-019, FRONTEND-030): a search box over the whole
 * library, a Top records / Team / Player bar, the data window, and the bar's
 * record cards.
 *
 * **What is shown.** With no query, Top records is the catalog's featured
 * records in `featured_rank` order, and Team or Player that group's whole
 * library in catalog order. A query (every whitespace-separated term found,
 * case-insensitive, in a record's title, category, group, unit or keywords)
 * searches the whole library on Top records and the group's on a group. The
 * filter runs over the cached catalog: typing asks nothing of it.
 *
 * **Pages.** 24 cards, and Load more adds 24. Each page's holders are one
 * read with its ids sorted (`recordHoldersQuery`), cached forever, so a page
 * already read asks nothing; a new page is asked for only once the box has
 * rested. A card's title and category come from the catalog at once, and its
 * holder area keeps its room while it loads. A failed page is one alert, and
 * its cards keep their titles and links.
 *
 * **The address.** The level carries the bar and the query; `onLevel` writes
 * both (the caller replaces the history entry). The box keeps its own text,
 * seeded from the level, so a keystroke never waits on the router.
 */
export function RecordsLevel({
  level,
  adapter,
  onLevel,
  onRecord,
  barEnd,
}: {
  level: RecordsLevelData;
  adapter: StatsNavAdapter;
  onLevel: (bar: RecordsBar, q: string) => void;
  onRecord: (id: string) => void;
  /** Set at the end of the group bar's row (the records tab's view bar). */
  barEnd?: ReactNode;
}) {
  const bar = level.group ?? "top";
  const searchId = useId();
  const list = useRef<HTMLUListElement>(null);
  const focusCard = useRef<number | null>(null);

  const [text, setText] = useState(level.q ?? "");
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    if (text === settled) return;
    const timer = setTimeout(() => setSettled(text), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [text, settled]);

  const catalog = useQuery(recordsQuery());
  const records = catalog.data?.records ?? [];
  const results = barRecords(records, bar, text);

  const pageKey = `${bar} ${queryTerms(text).join(" ")}`;
  const [paging, setPaging] = useState({ key: pageKey, pages: 1 });
  const pages = paging.key === pageKey ? paging.pages : 1;
  const shown = results.slice(0, pages * PAGE_SIZE);
  const pageIds: string[][] = [];
  for (let start = 0; start < shown.length; start += PAGE_SIZE)
    pageIds.push(shown.slice(start, start + PAGE_SIZE).map((r) => r.id));

  const holders = useQueries({
    queries: pageIds.map((ids) => ({
      ...recordHoldersQuery(ids),
      enabled: text === settled,
    })),
  });

  const settledTerms = queryTerms(settled);
  const count =
    catalog.data === undefined || settledTerms.length === 0
      ? null
      : barRecords(records, bar, settled).length;

  useEffect(() => {
    const index = focusCard.current;
    if (index === null) return;
    focusCard.current = null;
    list.current?.querySelectorAll("li")[index]?.querySelector("a")?.focus();
  }, [shown.length]);

  function holderOf(index: number, id: string): HolderState {
    const page = holders[Math.floor(index / PAGE_SIZE)];
    if (page?.data !== undefined)
      return { status: "done", holder: page.data.holders[id] ?? null };
    return page?.isError ? { status: "failed" } : { status: "pending" };
  }

  function clear(): void {
    setText("");
    setSettled("");
    onLevel(bar, "");
    // The button has gone with the empty state: focus returns to the box.
    document.getElementById(searchId)?.focus();
  }

  return (
    <div className={styles.section}>
      <SearchInput
        id={searchId}
        label="Search records"
        value={text}
        autoComplete="off"
        onChange={(event) => {
          setText(event.target.value);
          onLevel(bar, event.target.value);
        }}
      />
      <SegmentedTabs
        label="Record group"
        tabs={BARS}
        value={bar}
        onChange={(id) => onLevel(id as RecordsBar, text)}
        end={barEnd}
      >
        <div className={styles.section}>
          <p aria-live="polite" className="visually-hidden">
            {count === null
              ? ""
              : `${count.toLocaleString("en-US")} ${count === 1 ? "record" : "records"}`}
          </p>
          {catalog.isPending ? (
            <>
              <StatusLine>Loading the records…</StatusLine>
              <div aria-hidden="true" className={styles.cards}>
                {[0, 1, 2, 3].map((index) => (
                  <div
                    key={index}
                    className={`${styles.card} ${styles.cardHold}`}
                  >
                    <Skeleton variant="line" />
                  </div>
                ))}
              </div>
            </>
          ) : catalog.isError ? (
            <InlineAlert>
              We could not load the records just now. Please try again.
            </InlineAlert>
          ) : (
            <>
              {catalog.data.since_season === null ? null : (
                <p className={styles.muted}>
                  Since {catalog.data.since_season}
                  {catalog.data.through_season === null
                    ? null
                    : `, through ${catalog.data.through_season}`}
                </p>
              )}
              {results.length === 0 ? (
                queryTerms(text).length > 0 ? (
                  <EmptyState
                    action={
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={clear}
                      >
                        Clear search
                      </Button>
                    }
                  >
                    No records match “{text.trim()}”.
                  </EmptyState>
                ) : (
                  <EmptyState>There are no records here yet.</EmptyState>
                )
              ) : (
                <ul
                  ref={list}
                  className={styles.cards}
                  aria-label={groupTitle(bar)}
                >
                  {shown.map((record, index) => (
                    <RecordCard
                      key={record.id}
                      record={record}
                      holder={holderOf(index, record.id)}
                      adapter={adapter}
                      onOpen={() => onRecord(record.id)}
                    />
                  ))}
                </ul>
              )}
              {holders.map((page, index) =>
                page.isError ? (
                  <InlineAlert key={index}>
                    We could not load the holders of records{" "}
                    {index * PAGE_SIZE + 1}–
                    {index * PAGE_SIZE + pageIds[index].length} just now. Please
                    try again.
                  </InlineAlert>
                ) : null,
              )}
              {shown.length < results.length ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  className={styles.more}
                  onClick={() => {
                    focusCard.current = shown.length;
                    setPaging({ key: pageKey, pages: pages + 1 });
                  }}
                >
                  Load more records
                </Button>
              ) : null}
            </>
          )}
        </div>
      </SegmentedTabs>
    </div>
  );
}

/**
 * A record's card: its title, View all (the card's one control, stretched
 * over it), its category, and its holder as plain text in an area that keeps
 * its room while the holder loads.
 */
function RecordCard({
  record,
  holder: state,
  adapter,
  onOpen,
}: {
  record: RecordCatalogItemOut;
  holder: HolderState;
  adapter: StatsNavAdapter;
  onOpen: () => void;
}) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <h3>{record.title}</h3>
        <LevelLink
          level={{ kind: "record", id: record.id }}
          adapter={adapter}
          onGo={onOpen}
          label={`View all: ${record.title}`}
        >
          View all
        </LevelLink>
      </div>
      <p className={styles.muted}>{CATEGORY_LABELS[record.category]}</p>
      {/* Keeps the category and the value apart in the card's text; a flex
          container draws no whitespace-only text. */}{" "}
      <div className={styles.holder}>
        {state.status === "pending" ? (
          <Skeleton variant="line" />
        ) : state.status === "failed" ? null : (
          <Holder record={record} holder={state.holder} />
        )}
      </div>
    </li>
  );
}

/** A card's holder: the value, who holds it, and when; or nothing yet. */
function Holder({
  record,
  holder,
}: {
  record: RecordCatalogItemOut;
  holder: RecordHolderOut | null;
}) {
  if (holder === null)
    return (
      <div className={styles.recordEmpty}>
        <CourtScoreboard />
        <p className={styles.muted}>Nothing qualifies yet.</p>
      </div>
    );

  const others = holder.tied_count - 1;
  const team = holder.team?.name;
  const name =
    holder.player !== null
      ? playerName(holder.player) +
        (holder.game !== null && team !== undefined ? ` (${team})` : "")
      : (team ?? "");
  const { game } = holder;
  const when =
    game !== null
      ? formatGameDate(game.date) +
        (game.opponent_abbreviation === null
          ? ""
          : ` vs ${game.opponent_abbreviation}`)
      : holder.season;
  const unitless =
    record.value_kind === "win_loss" || record.value_kind === "shot_pct";

  return (
    <>
      <p>
        <RecordValue
          entry={holder}
          kind={record.value_kind}
          unit={unitless ? undefined : record.unit}
          strong
        />
      </p>
      <p>
        {holder.player === null && holder.team !== null ? (
          <>
            <TeamIcon abbreviation={holder.team.abbreviation} size="sm" />{" "}
          </>
        ) : null}
        {name}
        {others > 0 ? ` and ${others} other${others === 1 ? "" : "s"}` : ""}
      </p>
      {when === null ? null : <p className={styles.muted}>{when}</p>}
    </>
  );
}
