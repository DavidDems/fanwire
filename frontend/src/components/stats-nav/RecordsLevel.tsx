import { useQuery } from "@tanstack/react-query";

import {
  recordsQuery,
  type RecordGroup,
  type RecordSummaryOut,
} from "../../api/records";
import { formatGameDate } from "../../features/games/format";
import { CourtScoreboard } from "../visuals/CourtScoreboard";
import { InlineAlert } from "../ui/InlineAlert";
import { SegmentedTabs } from "../ui/SegmentedTabs";
import { Skeleton } from "../ui/Skeleton";
import { StatusLine } from "../ui/StatusLine";
import { LevelLink } from "./LevelLink";
import { formatRecordValue, groupTitle, playerName } from "./recordLabels";
import styles from "./StatsNav.module.css";
import type { StatsLevel, StatsNavAdapter } from "./types";

type RecordsLevelData = Extract<StatsLevel, { kind: "records" }>;

const GROUPS: { id: RecordGroup; label: string }[] = [
  { id: "team", label: "Team" },
  { id: "player", label: "Player" },
];

/**
 * The records level: a Team / Player bar over that group's record cards, in
 * the API's order, and one line naming the data window. The bar's tab
 * replaces the level (`onGroup`); a card's View all opens its record.
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
  const summary = useQuery(recordsQuery());
  const data = summary.data;

  return (
    <SegmentedTabs
      label="Record group"
      tabs={GROUPS}
      value={group}
      onChange={onGroup as (id: string) => void}
    >
      {summary.isPending ? (
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
      ) : summary.isError ? (
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
  record: RecordSummaryOut;
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
            <strong>{formatRecordValue(holder.value, record.unit)}</strong>{" "}
            {record.unit}
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
