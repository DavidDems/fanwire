import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";

import type { components } from "../../../api/schema";
import { useDetailLinkState } from "../../../routes/modal-flow";
import { formatDate, gameLabel } from "./format";
import styles from "./Previews.module.css";

type GameFinalPreviewView = components["schemas"]["GameFinalPreviewView"];
const PeriodScores = lazy(() =>
  import("./PeriodScores").then((module) => ({ default: module.PeriodScores })),
);

/**
 * A `game_final` data link on a post card (`FRONTEND-014`): the two teams and
 * the final score, the date and, for a playoff game, its label. Its one link
 * opens the game (`/games/<game_id>`) as a detail of the modal flow.
 */
export function GamePreview({ preview }: { preview: GameFinalPreviewView }) {
  const state = useDetailLinkState();
  const {
    away_team: away,
    home_team: home,
    away_score: awayScore,
    home_score: homeScore,
  } = preview;
  const label = gameLabel(preview.label, preview.sub_label);
  const winner =
    homeScore > awayScore
      ? home.name
      : awayScore > homeScore
        ? away.name
        : null;
  const awayPeriods = preview.away_line_score;
  const homePeriods = preview.home_line_score;

  return (
    <div className={styles.preview}>
      {label === "" ? null : <p className={styles.kicker}>{label}</p>}
      <p className={styles.headline}>
        <Link to={`/games/${preview.game_id}`} state={state}>
          {away.name} <span className={styles.score}>{awayScore}</span> at{" "}
          {home.name} <span className={styles.score}>{homeScore}</span>
        </Link>
      </p>
      <p className={styles.meta}>
        Final{winner === null ? "" : ` · ${winner} won`} ·{" "}
        <time dateTime={preview.date}>{formatDate(preview.date)}</time>
      </p>
      {awayPeriods === null || homePeriods === null ? null : (
        <Suspense fallback={null}>
          <PeriodScores
            awayTeam={away}
            homeTeam={home}
            awayPeriods={awayPeriods}
            homePeriods={homePeriods}
            awayScore={awayScore}
            homeScore={homeScore}
          />
        </Suspense>
      )}
    </div>
  );
}
