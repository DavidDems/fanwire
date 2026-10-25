import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { leadersQuery, type LeaderStat } from "../../api/stats";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import {
  ColumnHeader,
  ScrollTable,
} from "../../components/stats-nav/ScrollTable";
import { StatusLine } from "../../components/ui/StatusLine";
import { formatAverage } from "../games/format";
import { playerHref } from "./links";
import styles from "./Stats.module.css";

const BOARDS: ReadonlyArray<readonly [LeaderStat, string, string]> = [
  ["points", "Points per game", "PPG"],
  ["rebounds", "Rebounds per game", "RPG"],
  ["assists", "Assists per game", "APG"],
];

/**
 * A season's leaders: points, rebounds and assists, one read and one table
 * each, under the season level's standings (FRONTEND-019 moves them to
 * Records).
 */
export function Leaders({ season }: { season: string }) {
  // The rule is the same for every board of a season; it is read from the
  // first board, which is fetched (and cached) by its own table below.
  const points = useQuery(leadersQuery(season, "points"));

  return (
    <section className={styles.section} aria-labelledby="stats-leaders">
      <h3 id="stats-leaders">Leaders</h3>
      {points.data === undefined ? null : (
        <p className={styles.muted}>
          Regular season. To qualify, a player needs at least {points.data.rule}
          .
        </p>
      )}
      {BOARDS.map(([stat, caption, abbreviation]) => (
        <LeaderBoard
          key={stat}
          season={season}
          stat={stat}
          caption={caption}
          abbreviation={abbreviation}
        />
      ))}
    </section>
  );
}

function LeaderBoard({
  season,
  stat,
  caption,
  abbreviation,
}: {
  season: string;
  stat: LeaderStat;
  caption: string;
  abbreviation: string;
}) {
  const board = useQuery(leadersQuery(season, stat));

  if (board.isPending)
    return (
      <StatusLine>Loading the {caption.toLowerCase()} leaders…</StatusLine>
    );
  if (board.isError)
    return (
      <InlineAlert>
        We could not load the {caption.toLowerCase()} leaders just now.
      </InlineAlert>
    );
  if (board.data.leaders.length === 0)
    return (
      <EmptyState>
        No player qualifies for {caption.toLowerCase()} yet.
      </EmptyState>
    );

  return (
    <ScrollTable caption={caption} classes={styles}>
      <thead>
        <tr>
          <ColumnHeader classes={styles} label="#" title="Rank" />
          <ColumnHeader classes={styles} label="Player" name />
          <ColumnHeader classes={styles} label="Team" name />
          <ColumnHeader classes={styles} label="GP" title="Games played" />
          <ColumnHeader classes={styles} label={abbreviation} title={caption} />
        </tr>
      </thead>
      <tbody>
        {board.data.leaders.map((leader, index) => (
          <tr key={leader.player_id}>
            <td>{index + 1}</td>
            <th scope="row" className={styles.name}>
              <Link to={playerHref(leader.player_id)}>
                {`${leader.first_name} ${leader.last_name}`.trim()}
              </Link>
            </th>
            <td className={styles.name}>{leader.teams.join(", ")}</td>
            <td>{leader.games_played}</td>
            <td className={styles.figure}>{formatAverage(leader.average)}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}
