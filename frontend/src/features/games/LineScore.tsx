import type { TeamRefOut } from "./api";
import { periodHeaders } from "./format";
import styles from "./Games.module.css";

export interface LineScoreProps {
  awayTeam: TeamRefOut;
  homeTeam: TeamRefOut;
  awayLineScore: number[];
  homeLineScore: number[];
  awayScore: number;
  homeScore: number;
}

/**
 * Points by period, away row above home as the heading reads. The figures are
 * shown as the API stores them: four quarters, then each overtime, with the
 * seventh figure covering the third overtime and every one after it.
 */
export function LineScore({
  awayTeam,
  homeTeam,
  awayLineScore,
  homeLineScore,
  awayScore,
  homeScore,
}: LineScoreProps) {
  const headers = periodHeaders(
    Math.max(awayLineScore.length, homeLineScore.length),
  );
  const rows = [
    { team: awayTeam, figures: awayLineScore, total: awayScore },
    { team: homeTeam, figures: homeLineScore, total: homeScore },
  ];

  return (
    <div
      className={styles.scroll}
      role="region"
      aria-label="Line score"
      tabIndex={0}
    >
      <table className={styles.table}>
        <caption className={styles.caption}>Line score</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.name}>
              Team
            </th>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
            <th scope="col">T</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ team, figures, total }) => (
            <tr key={team.id}>
              <th scope="row" className={styles.name}>
                <abbr title={team.name}>{team.abbreviation}</abbr>
              </th>
              {headers.map((header, index) => (
                <td key={header}>{figures[index] ?? ""}</td>
              ))}
              <td className={styles.total}>{total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
