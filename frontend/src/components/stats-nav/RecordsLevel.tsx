import { useQuery } from "@tanstack/react-query";

import {
  recordHoldersQuery,
  recordsQuery,
  type RecordCatalogItemOut,
  type RecordGroup,
  type RecordHolderOut,
} from "../../api/records";
import { formatGameDate } from "../../features/games/format";
import { CourtScoreboard } from "../visuals/CourtScoreboard";
import { InlineAlert } from "../ui/InlineAlert";
import { SegmentedTabs } from "../ui/SegmentedTabs";
import { Skeleton } from "../ui/Skeleton";
import { StatusLine } from "../ui/StatusLine";
import { LevelLink } from "./LevelLink";
import { groupTitle, playerName } from "./recordLabels";
import { RecordValue } from "./RecordValue";
import styles from "./StatsNav.module.css";
import type { StatsLevel, StatsNavAdapter } from "./types";

type RecordsLevelData = Extract<StatsLevel, { kind: "records" }>;

const GROUPS: { id: RecordGroup; label: string }[] = [
  { id: "team", label: "Team" },
  { id: "player", label: "Player" },
];

/**
 * The cards this screen shows, in the order it has always shown them (each
 * group keeps its records' order here). TEMPORARY until `FRONTEND-030`: the
 * library's grid, search and featured page replace this fixed list, and only
 * then does the screen choose records from the catalog (`featured_rank`).
 */
const SCREEN_RECORDS: readonly string[] = [
  "team-championships",
  "team-best-season",
  "team-worst-season",
  "team-most-points-game",
  "team-largest-win",
  "player-championships",
  "player-points-game",
  "player-rebounds-game",
  "player-assists-game",
  "player-threes-game",
  "player-career-points",
  "player-career-triple-doubles",
];

/** A card's record: its catalog entry and its holder. */
type CardRecord = RecordCatalogItemOut & { holder: RecordHolderOut | null };

/**
 * The records level: a Team / Player bar over that group's record cards, in
 * the API's order, and one line naming the data window. The bar's tab
 * replaces the level (`onGroup`); a card's View all opens its record.
 *
 * The cards are `SCREEN_RECORDS` (`EVENTS-012`): the catalog, then one
 * holders read for all twelve (both groups, ids sorted), so switching the
 * group asks nothing.
 */
export function RecordsLevel({
  level,
  adapter,
  onGroup,
  onRecord,
}: {
  level: RecordsLevelData;
  adapter: StatsNavAdapter;
  onGroup: (group: RecordGroup) => void;
  onRecord: (id: string) => void;
}) {
  const group = level.group ?? "team";
  const catalog = useQuery(recordsQuery());
  const byId = new Map(
    (catalog.data?.records ?? []).map((record) => [record.id, record]),
  );
  const featured = SCREEN_RECORDS.flatMap((id) => {
    const record = byId.get(id);
    return record === undefined ? [] : [record];
  });
  const ids = featured.map((record) => record.id);
  const holders = useQuery({
    ...recordHoldersQuery(ids),
    enabled: ids.length > 0,
  });
  const asking = ids.length > 0;
  const pending = catalog.isPending || (asking && holders.isPending);
  const failed = catalog.isError || (asking && holders.isError);
  const data =
    catalog.data === undefined || (asking && holders.data === undefined)
      ? undefined
      : {
          ...catalog.data,
          records: featured.map((record): CardRecord => ({
            ...record,
            holder: holders.data?.holders[record.id] ?? null,
          })),
        };

  return (
    <SegmentedTabs
      label="Record group"
      tabs={GROUPS}
      value={group}
      onChange={onGroup as (id: string) => void}
    >
      {pending ? (
        <div className={styles.section}>
          <StatusLine>Loading the records…</StatusLine>
          <div aria-hidden="true" className={styles.cards}>
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className={`${styles.card} ${styles.cardHold}`}>
                <Skeleton variant="line" />
              </div>
            ))}
          </div>
        </div>
      ) : failed ? (
        <InlineAlert>
          We could not load the records just now. Please try again.
        </InlineAlert>
      ) : data === undefined ? null : (
        <div className={styles.section}>
          {data.since_season === null ? null : (
            <p className={styles.muted}>
              Since {data.since_season}
              {data.through_season === null
                ? null
                : `, through ${data.through_season}`}
            </p>
          )}
          <ul className={styles.cards} aria-label={groupTitle(group)}>
            {data.records
              .filter((record) => record.group === group)
              .map((record) => (
                <RecordCard
                  key={record.id}
                  record={record}
                  adapter={adapter}
                  onOpen={() => onRecord(record.id)}
                />
              ))}
          </ul>
        </div>
      )}
    </SegmentedTabs>
  );
}

/**
 * A record's card: its title, View all (the card's one control, stretched
 * over it) and its holder as plain text.
 */
function RecordCard({
  record,
  adapter,
  onOpen,
}: {
  record: CardRecord;
  adapter: StatsNavAdapter;
  onOpen: () => void;
}) {
  const holder = record.holder;
  const others = holder === null ? 0 : holder.tied_count - 1;
  const team = holder?.team?.name;
  const name =
    holder === null
      ? ""
      : holder.player !== null
        ? playerName(holder.player) +
          (holder.game !== null && team !== undefined ? ` (${team})` : "")
        : (team ?? "");
  const game = holder?.game ?? null;
  const when =
    game !== null
      ? formatGameDate(game.date) +
        (game.opponent_abbreviation === null
          ? ""
          : ` vs ${game.opponent_abbreviation}`)
      : (holder?.season ?? null);

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
      {holder === null ? (
        <div className={styles.recordEmpty}>
          <CourtScoreboard />
          <p className={styles.muted}>Nothing qualifies yet.</p>
        </div>
      ) : (
        <>
          <p>
            <RecordValue
              entry={holder}
              kind={record.value_kind}
              unit={record.value_kind === "win_loss" ? undefined : record.unit}
              strong
            />
          </p>
          <p>
            {name}
            {others > 0 ? ` and ${others} other${others === 1 ? "" : "s"}` : ""}
          </p>
          {when === null ? null : <p className={styles.muted}>{when}</p>}
        </>
      )}
    </li>
  );
}
