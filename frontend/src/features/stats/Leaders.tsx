import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  leaderBoardsQuery,
  type BoardLeaderOut,
  type BoardStat,
  type LeaderBoardOut,
} from "../../api/stats";
import {
  ColumnHeader,
  ScrollTable,
} from "../../components/stats-nav/ScrollTable";
import { CardEntry, StatCard } from "../../components/stats-nav/StatCard";
import nav from "../../components/stats-nav/StatsNav.module.css";
import { Dialog } from "../../components/ui/Dialog";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatusLine } from "../../components/ui/StatusLine";
import { CourtScoreboard } from "../../components/visuals/CourtScoreboard";
import { formatAverage } from "../games/format";
import { DetailLink } from "./DetailLink";
import { playerHref } from "./links";
import styles from "./Stats.module.css";

interface Board {
  stat: BoardStat;
  /** The card's `h3`, and the View all button's and the dialog's name. */
  title: string;
  /** The dialog's value column, abbreviated. */
  abbreviation: string;
  percentage: boolean;
}

function board(
  stat: BoardStat,
  title: string,
  abbreviation: string,
  percentage = false,
): Board {
  return { stat, title, abbreviation, percentage };
}

/** EVENTS-017's board order, which the cards keep. */
const BOARDS: readonly Board[] = [
  board("points", "Points per game", "PPG"),
  board("assists", "Assists per game", "APG"),
  board("rebounds", "Rebounds per game", "RPG"),
  board("blocks", "Blocks per game", "BPG"),
  board("steals", "Steals per game", "SPG"),
  board("field_goals_made", "Field goals made per game", "FGM"),
  board("threes", "Threes made per game", "3PM"),
  board("field_goal_pct", "Field goal %", "FG%", true),
  board("three_point_pct", "Three-point %", "3P%", true),
  board("field_goals_attempted", "Field goals attempted per game", "FGA"),
  board("three_pointers_attempted", "Threes attempted per game", "3PA"),
];

/** How many leaders a card shows; its dialog shows every one read (ten). */
const CARD_TOP = 3;

function nameOf(leader: BoardLeaderOut): string {
  return [leader.first_name, leader.last_name]
    .filter((part) => part !== null && part !== "")
    .join(" ");
}

/** A count board's average to one place; a percentage board's 0-1 as `72.5%`. */
function valueOf(leader: BoardLeaderOut, percentage: boolean): string {
  return percentage
    ? `${(leader.value * 100).toFixed(1)}%`
    : formatAverage(leader.value);
}

function gamesOf(leader: BoardLeaderOut): string {
  return `${leader.games_played} ${leader.games_played === 1 ? "game" : "games"}`;
}

/**
 * Records > Seasonal's leaders (FRONTEND-043): the season's eleven leader
 * boards as cards in the Historical cards' style (the shared `StatCard` and
 * `CardEntry`), in EVENTS-017's board order, under one muted line naming the
 * qualifier. A card shows its top three, each player's name opening the
 * player in the detail modal (FRONTEND-041); its View all opens the board's
 * top ten in a dialog, local state over the page rather than a route.
 *
 * **One read per season**: `GET .../leader-boards?limit=10`, cached for the
 * season reads' five minutes; the cards and every dialog are drawn from it,
 * so opening a dialog asks nothing.
 */
export function Leaders({ season }: { season: string }) {
  const answer = useQuery(leaderBoardsQuery(season));
  const [viewing, setViewing] = useState<BoardStat | null>(null);

  if (answer.isPending)
    return (
      <div className={styles.section}>
        <StatusLine>Loading the leaders…</StatusLine>
        <div aria-hidden="true" className={nav.cards}>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className={`${nav.card} ${nav.cardHold}`}>
              <Skeleton variant="line" />
            </div>
          ))}
        </div>
      </div>
    );
  if (answer.isError)
    return (
      <InlineAlert>
        We could not load the leaders just now. Please try again.
      </InlineAlert>
    );

  const { boards, complete, rule } = answer.data;
  const shown = BOARDS.flatMap((meta) => {
    const data = boards.find((b) => b.stat === meta.stat);
    return data === undefined ? [] : [{ meta, data }];
  });
  const open = shown.find(({ meta }) => meta.stat === viewing);

  return (
    <div className={styles.section}>
      <p className={styles.muted}>
        {complete ? `Qualifying: ${rule}` : `Season in progress: ${rule}`}
      </p>
      <ul className={nav.cards} aria-label="Leader boards">
        {shown.map(({ meta, data }) => (
          <LeaderCard
            key={meta.stat}
            meta={meta}
            data={data}
            onViewAll={() => setViewing(meta.stat)}
          />
        ))}
      </ul>
      <Dialog
        open={open !== undefined}
        onClose={() => setViewing(null)}
        title={
          open === undefined ? "" : `${open.meta.title} leaders, ${season}`
        }
      >
        {open === undefined ? null : (
          <LeaderTable meta={open.meta} data={open.data} />
        )}
      </Dialog>
    </div>
  );
}

/**
 * A board's card: its title and View all, then its top three. The leader,
 * and anyone tied with them, is semibold. The card is not stretched: each
 * player's name and View all are controls of their own. A board no player
 * qualifies for yet says so and has nothing to view.
 */
function LeaderCard({
  meta,
  data,
  onViewAll,
}: {
  meta: Board;
  data: LeaderBoardOut;
  onViewAll: () => void;
}) {
  const { leaders } = data;
  const top = leaders[0]?.value;

  return (
    <StatCard
      title={meta.title}
      action={
        leaders.length === 0 ? null : (
          <button
            type="button"
            className={nav.control}
            aria-label={`View all ${meta.title} leaders`}
            onClick={onViewAll}
          >
            View all
          </button>
        )
      }
    >
      <div className={nav.holder}>
        {leaders.length === 0 ? (
          <div className={nav.recordEmpty}>
            <CourtScoreboard />
            <p className={nav.muted}>No player qualifies yet.</p>
          </div>
        ) : (
          <ol className={nav.top}>
            {leaders.slice(0, CARD_TOP).map((leader) => {
              const lead = leader.value === top;
              const value = valueOf(leader, meta.percentage);
              return (
                <CardEntry
                  key={leader.player_id}
                  lead={lead}
                  name={
                    <DetailLink to={playerHref(leader.player_id)}>
                      {nameOf(leader)}
                    </DetailLink>
                  }
                  value={lead ? <strong>{value}</strong> : value}
                  detail={[
                    leader.teams.join(", "),
                    gamesOf(leader),
                    ...(meta.percentage &&
                    leader.made !== null &&
                    leader.attempted !== null
                      ? [`${leader.made}-${leader.attempted}`]
                      : []),
                  ].join(" · ")}
                />
              );
            })}
          </ol>
        )}
      </div>
    </StatCard>
  );
}

/** A board's top ten, in the View all dialog, under the board's own rule. */
function LeaderTable({ meta, data }: { meta: Board; data: LeaderBoardOut }) {
  const top = data.leaders[0]?.value;
  return (
    <div className={styles.section}>
      <p className={styles.muted}>Qualifying: {data.rule}</p>
      <ScrollTable caption={`${meta.title}, top ${data.leaders.length}`}>
        <thead>
          <tr>
            <ColumnHeader label="#" title="Rank" />
            <ColumnHeader label="Player" name />
            <ColumnHeader label="Team" name />
            <ColumnHeader label="GP" title="Games played" />
            {meta.percentage ? (
              <>
                <ColumnHeader label="Made" />
                <ColumnHeader label="Att" title="Attempted" />
              </>
            ) : null}
            <ColumnHeader label={meta.abbreviation} title={meta.title} />
          </tr>
        </thead>
        <tbody>
          {data.leaders.map((leader) => (
            <tr key={leader.player_id}>
              {/* Tied values share a rank (1, 1, 3): the first index holding it. */}
              <td>
                {data.leaders.findIndex(
                  (other) => other.value === leader.value,
                ) + 1}
              </td>
              <th
                scope="row"
                className={
                  leader.value === top ? `${nav.name} ${nav.lead}` : nav.name
                }
              >
                {nameOf(leader)}
              </th>
              <td className={nav.name}>{leader.teams.join(", ")}</td>
              <td>{leader.games_played}</td>
              {meta.percentage ? (
                <>
                  <td>{leader.made ?? "–"}</td>
                  <td>{leader.attempted ?? "–"}</td>
                </>
              ) : null}
              <td className={nav.figure}>{valueOf(leader, meta.percentage)}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </div>
  );
}
