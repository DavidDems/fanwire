import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import {
  championQuery,
  standingsQuery,
  type StandingRowOut,
  type StandingsOut,
} from "../../api/stats";
import { EmptyState } from "../ui/EmptyState";
import { InlineAlert } from "../ui/InlineAlert";
import { SegmentedTabs } from "../ui/SegmentedTabs";
import { Skeleton } from "../ui/Skeleton";
import { StatusLine } from "../ui/StatusLine";
import { formatPercentage } from "../../features/games/format";
import { LevelLink } from "./LevelLink";
import { ColumnHeader, ScrollTable } from "./ScrollTable";
import styles from "./StatsNav.module.css";
import type { Conference, StatsLevel, StatsNavAdapter } from "./types";

type SeasonLevelData = Extract<StatsLevel, { kind: "season" }>;

const CONFERENCES: { id: Conference; label: string }[] = [
  { id: "all", label: "All" },
  { id: "east", label: "East" },
  { id: "west", label: "West" },
];

/**
 * The season level: the champion, then the standings under an All / East /
 * West bar that filters the one standings read on the client. While the
 * champion or the All standings load, their place is held at full height, so
 * nothing below moves when they land.
 */
export function SeasonLevel({
  level,
  adapter,
  onConference,
  onTeam,
}: {
  level: SeasonLevelData;
  adapter: StatsNavAdapter;
  onConference: (conf: Conference) => void;
  onTeam: (teamId: number) => void;
}) {
  const id = useId();
  const { season, conf } = level;
  const champion = useQuery(championQuery(season));
  const standings = useQuery(standingsQuery(season));
  const data = champion.data;

  return (
    <>
      <section className={styles.section} aria-labelledby={`${id}c`}>
        <h3 id={`${id}c`}>Champion</h3>
        <div className={styles.championBody}>
          {champion.isPending ? (
            <>
              <StatusLine>Loading the champion…</StatusLine>
              <Skeleton variant="line" />
            </>
          ) : champion.isError ? (
            <InlineAlert>
              We could not load this season’s champion just now. Please try
              again.
            </InlineAlert>
          ) : data === undefined ? null : data.champion === null ? (
            <EmptyState>The {season} season has no champion yet.</EmptyState>
          ) : (
            <p>
              <strong>{data.champion.name}</strong>
              {data.runner_up === null ? null : ` beat ${data.runner_up.name}`}
              {data.result === null ? null : ` in the Finals, ${data.result}`}.
            </p>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby={`${id}s`}>
        <h3 id={`${id}s`}>Standings</h3>
        <SegmentedTabs
          label="Conference"
          tabs={CONFERENCES}
          value={conf}
          onChange={onConference as (id: string) => void}
        >
          {standings.isPending ? (
            <div className={conf === "all" ? styles.hold : undefined}>
              <StatusLine>Loading the standings…</StatusLine>
              <Skeleton variant="line" />
            </div>
          ) : standings.isError ? (
            <InlineAlert>
              We could not load the standings just now. Please try again.
            </InlineAlert>
          ) : (
            <StandingsTables
              standings={standings.data}
              level={level}
              adapter={adapter}
              onTeam={onTeam}
            />
          )}
        </SegmentedTabs>
      </section>
    </>
  );
}

/** Win percentage, then wins, then name: the API's conference order. */
function conferenceOrder(a: StandingRowOut, b: StandingRowOut): number {
  return (
    b.win_pct - a.win_pct ||
    b.wins - a.wins ||
    a.team.name.localeCompare(b.team.name)
  );
}

function StandingsTables({
  standings,
  level,
  adapter,
  onTeam,
}: {
  standings: StandingsOut;
  level: SeasonLevelData;
  adapter: StatsNavAdapter;
  onTeam: (teamId: number) => void;
}) {
  if (standings.conferences.length === 0)
    return (
      <EmptyState>
        There are no standings for {standings.season} yet.
      </EmptyState>
    );

  const shown = standings.conferences.filter(
    (conference) =>
      level.conf === "all" ||
      conference.conference.toLowerCase().startsWith(level.conf),
  );

  return (
    <div className={styles.section}>
      {shown.map((conference) => {
        // One table per conference, in the conference's own order: the API
        // groups by division, and a table that concatenated the divisions
        // would rank a division winner above a better record.
        const rows = conference.divisions
          .flatMap((division) =>
            division.teams.map((row) => ({ row, division: division.division })),
          )
          .sort((a, b) => conferenceOrder(a.row, b.row));
        return (
          <ScrollTable
            key={conference.conference}
            caption={`${conference.conference} Conference`}
          >
            <thead>
              <tr>
                <ColumnHeader label="Team" name />
                <ColumnHeader label="W" title="Wins" />
                <ColumnHeader label="L" title="Losses" />
                <ColumnHeader label="PCT" title="Win percentage" />
                <ColumnHeader label="GB" title="Games behind" />
                <ColumnHeader label="Home" />
                <ColumnHeader label="Away" />
                <ColumnHeader label="Division" name />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, division }) => (
                <tr key={row.team.id}>
                  <th scope="row" className={styles.name}>
                    <LevelLink
                      level={{
                        kind: "team",
                        season: level.season,
                        teamId: row.team.id,
                      }}
                      adapter={adapter}
                      onGo={() => onTeam(row.team.id)}
                    >
                      {row.team.name}
                    </LevelLink>
                  </th>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td>{formatPercentage(row.win_pct)}</td>
                  <td>{row.games_behind === 0 ? "–" : row.games_behind}</td>
                  <td>{`${row.home_wins}-${row.home_losses}`}</td>
                  <td>{`${row.away_wins}-${row.away_losses}`}</td>
                  <td className={styles.name}>{division}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        );
      })}
      <p className={styles.muted}>Ties broken by: {standings.tie_break}.</p>
    </div>
  );
}
