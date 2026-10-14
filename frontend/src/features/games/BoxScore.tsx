import { EmptyState } from "../../components/ui/EmptyState";
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
}

/**
 * One team's box score: its table in a focusable scroll container (so a
 * keyboard user can scroll it sideways on a phone), then who did not play.
 * Starters come first and the bench after, each in the order the API sent.
 */
export function BoxScore({ team, boxScore }: BoxScoreProps) {
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
              </tr>
            </thead>
            <tbody>
              {starters.map((player) => (
                <PlayerRow key={player.player_id} player={player} />
              ))}
              {bench.map((player, index) => (
                <PlayerRow
                  key={player.player_id}
                  player={player}
                  firstOfBench={index === 0 && starters.length > 0}
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

function PlayerRow({
  player,
  firstOfBench = false,
}: {
  player: BoxScorePlayerOut;
  firstOfBench?: boolean;
}) {
  return (
    <tr className={firstOfBench ? styles.benchStart : undefined}>
      <th scope="row" className={styles.name}>
        {fullName(player)}
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
    </tr>
  );
}
