import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  RECORDS_KEY,
  recordQuery,
  type RecordEntryOut,
  type RecordListOut,
  type RecordsSummaryOut,
} from "../../api/records";
import { formatGameDate } from "../../features/games/format";
import { EmptyState } from "../ui/EmptyState";
import { InlineAlert } from "../ui/InlineAlert";
import { Skeleton } from "../ui/Skeleton";
import { StatusLine } from "../ui/StatusLine";
import { formatRecordValue, isRate, playerName } from "./recordLabels";
import { ColumnHeader, ScrollTable } from "./ScrollTable";
import styles from "./StatsNav.module.css";
import type { StatsLevel, StatsNavAdapter } from "./types";

type RecordLevelData = Extract<StatsLevel, { kind: "record" }>;

/**
 * A record's title for its level: from the summary when it is already cached
 * (read without asking), else from the record's list (the read its view
 * makes), so it is never empty once a card opened it.
 */
export function RecordTitle({ id }: { id: string }) {
  const cached = useQueryClient()
    .getQueryData<RecordsSummaryOut>(RECORDS_KEY)
    ?.records.find((record) => record.id === id)?.title;
  const list = useQuery(recordQuery(id));
  return (
    <>
      {cached ??
        (list.data === null ? "Record not found" : list.data?.title) ??
        "Record"}
    </>
  );
}

/**
 * The record level: the record's rule, its data window and its whole ranked
 * list (up to its top 100) in one table, with the API's ranks as given. A
 * column the record has no value for is left out.
 */
export function RecordLevel({
  level,
  adapter,
}: {
  level: RecordLevelData;
  adapter: StatsNavAdapter;
}) {
  const list = useQuery(recordQuery(level.id));

  if (list.isPending)
    return (
      <div className={styles.listHold}>
        <StatusLine>Loading the record…</StatusLine>
        <Skeleton variant="line" />
      </div>
    );
  if (list.isError)
    return (
      <InlineAlert>
        We could not load this record just now. Please try again.
      </InlineAlert>
    );
  if (list.data === null)
    return <EmptyState>Not found: there is no such record.</EmptyState>;

  return <RecordList data={list.data} adapter={adapter} />;
}

function RecordList({
  data,
  adapter,
}: {
  data: RecordListOut;
  adapter: StatsNavAdapter;
}) {
  const { entries, group, unit } = data;
  const isPlayer = group === "player";
  const hasGame = entries.some((entry) => entry.game !== null);
  const hasSeason = !hasGame && entries.some((entry) => entry.season !== null);
  // A team record's team is its row header; a player's is a column of its own.
  const hasTeam = isPlayer && entries.some((entry) => entry.team !== null);
  // A season record ranks the exact fraction, shown to three places.
  const rate = isRate(unit);

  return (
    <>
      <p className={styles.muted}>{data.rule}</p>
      {data.since_season === null ? null : (
        <p className={styles.muted}>Since {data.since_season}</p>
      )}
      {entries.length === 0 ? (
        <EmptyState>Nothing qualifies for this record yet.</EmptyState>
      ) : (
        <ScrollTable caption={`${data.title}, top ${data.total}`}>
          <thead>
            <tr>
              <ColumnHeader label="#" title="Rank" />
              <ColumnHeader label={isPlayer ? "Player" : "Team"} name />
              {hasTeam ? <ColumnHeader label="Team" name /> : null}
              {hasSeason ? <ColumnHeader label="Season" name /> : null}
              {hasGame ? <ColumnHeader label="Date" name /> : null}
              {hasGame ? (
                <ColumnHeader label="Opp" title="Opponent" name />
              ) : null}
              <ColumnHeader
                label={unit.charAt(0).toUpperCase() + unit.slice(1)}
              />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={index}>
                <td>{entry.rank}</td>
                <th scope="row" className={styles.name}>
                  <Holder entry={entry} isPlayer={isPlayer} adapter={adapter} />
                </th>
                {hasTeam ? (
                  <td className={styles.name}>{entry.team?.name ?? "–"}</td>
                ) : null}
                {hasSeason ? (
                  <td className={styles.name}>{entry.season ?? "–"}</td>
                ) : null}
                {hasGame ? (
                  <td className={styles.name}>
                    {entry.game === null
                      ? "–"
                      : adapter.gameLink(
                          entry.game.id,
                          formatGameDate(entry.game.date),
                        )}
                  </td>
                ) : null}
                {hasGame ? (
                  <td className={styles.name}>
                    {entry.game?.opponent_abbreviation ?? "–"}
                  </td>
                ) : null}
                <td className={styles.figure}>
                  {formatRecordValue(entry.value, unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      {rate && hasSeason ? (
        <p className={styles.muted}>
          Ranked by the exact win percentage, so two teams that show the same
          three places can rank apart.
        </p>
      ) : null}
    </>
  );
}

/** The row's holder: a player linked to their page, or a team to Seasons. */
function Holder({
  entry,
  isPlayer,
  adapter,
}: {
  entry: RecordEntryOut;
  isPlayer: boolean;
  adapter: StatsNavAdapter;
}) {
  if (isPlayer)
    return entry.player === null ? (
      <>–</>
    ) : (
      <>{adapter.playerLink(entry.player.id, playerName(entry.player))}</>
    );
  const { team } = entry;
  if (team === null) return <>–</>;
  return (
    <>
      {adapter.teamLink === undefined
        ? team.name
        : adapter.teamLink(team.id, entry.season, team.name)}
    </>
  );
}
