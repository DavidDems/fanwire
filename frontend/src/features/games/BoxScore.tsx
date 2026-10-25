import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { EmptyState } from "../../components/ui/EmptyState";
import { SquarePenIcon } from "../../components/ui/icons";
import { VisuallyHidden } from "../../components/ui/VisuallyHidden";
import {
  useComposeLinkState,
  useInFlowLinkState,
} from "../../routes/modal-flow";
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
 * **`?line=<line_id>`** (`FRONTEND-014`, a player-game link's destination)
 * marks that row as the current one, and scrolls it into view: on the page and
 * in the modal alike. An id no row has marks nothing.
 *
 * The post links sit in a trailing column of their own, not in the name cell,
 * so the row header keeps its one link and the eighteen stat columns stay
 * where they are; a guest's table has no such column at all.
 */
export function BoxScore({ team, boxScore, gameId, canPost }: BoxScoreProps) {
  const { players, did_not_play: didNotPlay, totals } = boxScore;
  const [searchParams] = useSearchParams();
  const line = lineIdFrom(searchParams.get("line"));
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
                  current={player.line_id === line}
                  postHref={rowPostHref(player, gameId, canPost)}
                />
              ))}
              {bench.map((player, index) => (
                <PlayerRow
                  key={player.player_id}
                  player={player}
                  firstOfBench={index === 0 && starters.length > 0}
                  current={player.line_id === line}
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

/** The `line` in the address, or `null` for anything that is not an id. */
function lineIdFrom(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
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

/**
 * Centres `row` in the nearest ancestor that scrolls vertically, or, with
 * none (a full page, where the window scrolls), in the window. Not plain
 * `scrollIntoView` everywhere: that scrolls every scrollable ancestor, and in
 * the modal it scrolled the dialog itself (its header off the top) and the
 * page under the modal (so closing returned to the wrong scroll).
 */
function revealRow(row: HTMLElement) {
  for (
    let el = row.parentElement;
    el !== null && el !== document.body;
    el = el.parentElement
  ) {
    const { overflowY } = getComputedStyle(el);
    const scrolls = overflowY === "auto" || overflowY === "scroll";
    if (scrolls && el.scrollHeight > el.clientHeight) {
      const box = el.getBoundingClientRect();
      const target = row.getBoundingClientRect();
      el.scrollTop +=
        target.top + target.height / 2 - (box.top + box.height / 2);
      return;
    }
  }
  // In the modal with nothing overflowing, the row is already in view:
  // "nearest" leaves every ancestor where it is.
  row.scrollIntoView({
    block: row.closest("dialog") === null ? "center" : "nearest",
  });
}

function PlayerRow({
  player,
  firstOfBench = false,
  current = false,
  postHref,
}: {
  player: BoxScorePlayerOut;
  firstOfBench?: boolean;
  /** The row `?line=` names: marked, and scrolled into view once. */
  current?: boolean;
  postHref: string | null | undefined;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  // Inside the modal, a player's name is the flow's next detail; on the page,
  // a plain link to the player's page.
  const state = useInFlowLinkState();
  // FRONTEND-020: "Post" opens the composer over this page (or the flow's).
  const composeState = useComposeLinkState();

  useEffect(() => {
    if (current && ref.current !== null) revealRow(ref.current);
  }, [current]);

  const className = [
    firstOfBench ? styles.benchStart : "",
    current ? styles.current : "",
  ]
    .filter((name) => name !== "")
    .join(" ");

  return (
    <tr
      ref={ref}
      className={className === "" ? undefined : className}
      aria-current={current ? "true" : undefined}
    >
      <th scope="row" className={styles.name}>
        <Link to={`/players/${player.player_id}`} state={state}>
          {fullName(player)}
        </Link>
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
            <Link
              to={postHref}
              state={composeState}
              className={styles.postLink}
            >
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
