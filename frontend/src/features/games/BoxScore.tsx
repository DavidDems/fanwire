import { Link } from "react-router-dom";

import { EmptyState } from "../../components/ui/EmptyState";
import { SquarePenIcon } from "../../components/ui/icons";
import { VisuallyHidden } from "../../components/ui/VisuallyHidden";
import type {
  BoxScorePlayerOut,
  DidNotPlayOut,
  TeamBoxScoreOut,
  TeamRefOut,
} from "./api";
import {
  formatMadeAttempted,
  formatMinutes,
  formatPercentage,
  formatPlusMinus,
} from "./format";
import styles from "./Games.module.css";
import { postAboutLineHref } from "./postLinks";

/** The eighteen columns, with the full name of each abbreviation. */
const COLUMNS: ReadonlyArray<readonly [string, string | null]> = [
  ["Player", null],
  ["MIN", "Minutes"],
  ["FG", "Field goals made-attempted"],
  ["3P", "Three-pointers made-attempted"],
  ["FT", "Free throws made-attempted"],
  ["FG%", "Field goal percentage"],
  ["3P%", "Three-point percentage"],
  ["FT%", "Free throw percentage"],
  ["OREB", "Offensive rebounds"],
  ["DREB", "Defensive rebounds"],
  ["REB", "Rebounds"],
  ["AST", "Assists"],
  ["STL", "Steals"],
  ["BLK", "Blocks"],
  ["TO", "Turnovers"],
  ["PF", "Personal fouls"],
  ["+/-", "Plus-minus"],
  ["PTS", "Points"],
];

function fullName(player: BoxScorePlayerOut | DidNotPlayOut): string {
  return [player.first_name, player.last_name]
    .filter((part): part is string => part !== null && part !== "")
    .join(" ");
}

export interface BoxScoreProps {
  team: TeamRefOut;
  boxScore: TeamBoxScoreOut;
  /** The game the box score belongs to, for each row's post link. */
  gameId: number;
  /**
   * Whether the viewer is signed in: if so, the table gains a trailing
   * "Post" column, a link in each played row (`FRONTEND-017`).
   */
  canPost: boolean;
}

/**
 * One team's box score: its table in a focusable scroll container (so a
 * keyboard user can scroll it sideways on a phone), then who did not play.
 * Starters come first and the bench after, each in the order the API sent.
 *
 * The post links sit in a trailing column of their own, not in the name cell,
 * so the row header keeps its one link and the eighteen stat columns stay
 * where they are; a guest's table has no such column at all.
 */
export function BoxScore({ team, boxScore, gameId, canPost }: BoxScoreProps) {
  const { players, did_not_play: didNotPlay, totals } = boxScore;
  const headingId = `box-score-${team.id}`;
  const starters = players.filter((player) => player.starter);
  const bench = players.filter((player) => !player.starter);

  return (
    <section className={styles.team} aria-labelledby={headingId}>
      <h2 id={headingId}>{team.name}</h2>

      {players.length === 0 ? (
        <EmptyState>No box score is available for {team.name}.</EmptyState>
      ) : (
        <div
          className={styles.scroll}
          role="region"
          aria-label={`${team.name} box score`}
          tabIndex={0}
        >
          <table className={styles.table}>
            <caption className={styles.caption}>{team.name} box score</caption>
            <thead>
              <tr>
                {COLUMNS.map(([label, title]) => (
                  <th
                    key={label}
                    scope="col"
                    className={label === "Player" ? styles.name : undefined}
                  >
                    {title === null ? (
                      label
                    ) : (
                      <abbr title={title}>{label}</abbr>
                    )}
                  </th>
                ))}
                {canPost ? (
                  <th scope="col" className={styles.postCell}>
                    <VisuallyHidden>Post</VisuallyHidden>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {starters.map((player) => (
                <PlayerRow
                  key={player.player_id}
                  player={player}
                  postHref={rowPostHref(player, gameId, canPost)}
                />
              ))}
              {bench.map((player, index) => (
                <PlayerRow
                  key={player.player_id}
                  player={player}
                  firstOfBench={index === 0 && starters.length > 0}
                  postHref={rowPostHref(player, gameId, canPost)}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className={styles.totals}>
                <th scope="row" className={styles.name}>
                  Totals
                </th>
                <td>{formatMinutes(totals.seconds_played)}</td>
                <td>
                  {formatMadeAttempted(
                    totals.field_goals_made,
                    totals.field_goals_attempted,
                  )}
                </td>
                <td>
                  {formatMadeAttempted(
                    totals.three_pointers_made,
                    totals.three_pointers_attempted,
                  )}
                </td>
                <td>
                  {formatMadeAttempted(
                    totals.free_throws_made,
                    totals.free_throws_attempted,
                  )}
                </td>
                <td>{formatPercentage(totals.field_goal_pct)}</td>
                <td>{formatPercentage(totals.three_point_pct)}</td>
                <td>{formatPercentage(totals.free_throw_pct)}</td>
                <td>{totals.offensive_rebounds}</td>
                <td>{totals.defensive_rebounds}</td>
                <td>{totals.rebounds}</td>
                <td>{totals.assists}</td>
                <td>{totals.steals}</td>
                <td>{totals.blocks}</td>
                <td>{totals.turnovers}</td>
                <td>{totals.personal_fouls}</td>
                <td />
                <td>{totals.points}</td>
                {canPost ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {didNotPlay.length === 0 ? null : (
        <ul className={styles.dnp} aria-label={`${team.name}: did not play`}>
          {didNotPlay.map((player) => (
            <li key={player.player_id}>
              <span className={styles.dnpName}>{fullName(player)}</span>
              {": "}
              <span className={styles.muted}>
                {player.dnp_reason ?? "Did not play"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The row's post-link address: `undefined` for a guest (no column), `null`
 * for a row stored as did-not-play (an empty cell), else the line's address.
 */
function rowPostHref(
  player: BoxScorePlayerOut,
  gameId: number,
  canPost: boolean,
): string | null | undefined {
  if (!canPost) return undefined;
  // The schema types it as a number, but a stored DNP row carries null.
  const seconds = player.seconds_played as number | null;
  return seconds === null ? null : postAboutLineHref(player.line_id, gameId);
}

function PlayerRow({
  player,
  firstOfBench = false,
  postHref,
}: {
  player: BoxScorePlayerOut;
  firstOfBench?: boolean;
  postHref: string | null | undefined;
}) {
  return (
    <tr className={firstOfBench ? styles.benchStart : undefined}>
      <th scope="row" className={styles.name}>
        <Link to={`/players/${player.player_id}`}>{fullName(player)}</Link>
        {player.starting_position === null ? null : (
          <span className={styles.position}> {player.starting_position}</span>
        )}
      </th>
      <td>{formatMinutes(player.seconds_played)}</td>
      <td>
        {formatMadeAttempted(
          player.field_goals_made,
          player.field_goals_attempted,
        )}
      </td>
      <td>
        {formatMadeAttempted(
          player.three_pointers_made,
          player.three_pointers_attempted,
        )}
      </td>
      <td>
        {formatMadeAttempted(
          player.free_throws_made,
          player.free_throws_attempted,
        )}
      </td>
      <td>{formatPercentage(player.field_goal_pct)}</td>
      <td>{formatPercentage(player.three_point_pct)}</td>
      <td>{formatPercentage(player.free_throw_pct)}</td>
      <td>{player.offensive_rebounds}</td>
      <td>{player.defensive_rebounds}</td>
      <td>{player.rebounds}</td>
      <td>{player.assists}</td>
      <td>{player.steals}</td>
      <td>{player.blocks}</td>
      <td>{player.turnovers}</td>
      <td>{player.personal_fouls}</td>
      <td>{formatPlusMinus(player.plus_minus)}</td>
      <td>{player.points}</td>
      {postHref === undefined ? null : (
        <td className={styles.postCell}>
          {postHref === null ? null : (
            <Link to={postHref} className={styles.postLink}>
              <SquarePenIcon size={16} />
              Post
              <VisuallyHidden>
                {` about ${fullName(player)}’s game`}
              </VisuallyHidden>
            </Link>
          )}
        </td>
      )}
    </tr>
  );
}
