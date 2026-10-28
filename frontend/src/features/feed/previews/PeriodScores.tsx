import type { components } from "../../../api/schema";
import styles from "./Previews.module.css";

type Team = components["schemas"]["TeamRefView"];

export function PeriodScores({
  awayTeam,
  homeTeam,
  awayPeriods,
  homePeriods,
  awayScore,
  homeScore,
}: {
  awayTeam: Team;
  homeTeam: Team;
  awayPeriods: number[];
  homePeriods: number[];
  awayScore: number;
  homeScore: number;
}) {
  if (
    awayPeriods.length !== homePeriods.length ||
    total(awayPeriods) !== awayScore ||
    total(homePeriods) !== homeScore
  ) {
    return null;
  }

  const periods = periodLabels(awayPeriods.length);

  return (
    <div className={styles.periodScroll}>
      <table className={styles.periods}>
        <caption className={styles.periodCaption}>Period score</caption>
        <thead>
          <tr>
            <th scope="col">Team</th>
            {periods.map((period) => (
              <th scope="col" key={period}>
                {period}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            { team: awayTeam, figures: awayPeriods },
            { team: homeTeam, figures: homePeriods },
          ].map(({ team, figures }) => (
            <tr key={team.id}>
              <th scope="row">{team.name}</th>
              {figures.map((score, index) => (
                <td key={`${team.id}-${periods[index]}`}>{score}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function total(scores: number[]) {
  return scores.reduce((sum, value) => sum + value, 0);
}

function periodLabels(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    if (index < 4) return `Q${index + 1}`;
    return index === 4 ? "OT" : `${index - 3}OT`;
  });
}
