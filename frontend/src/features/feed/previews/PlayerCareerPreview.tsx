import { Link } from "react-router-dom";

import type { components } from "../../../api/schema";
import { useDetailLinkState } from "../../../routes/modal-flow";
import { Figures } from "./Figures";
import { formatAverage, formatPercentage, playerName } from "./format";
import styles from "./Previews.module.css";

type PlayerCareerPreviewView = components["schemas"]["PlayerCareerPreviewView"];

/**
 * A `player_career` data link on a post card (`FRONTEND-014`): the player, the
 * scope's label (Regular season or Playoffs), games played and the per-game
 * figures, a figure the source does not have shown as an em dash. Its one link
 * opens the player (`/players/<player_id>`).
 */
export function PlayerCareerPreview({
  preview,
}: {
  preview: PlayerCareerPreviewView;
}) {
  const state = useDetailLinkState();
  const name = playerName(
    preview.first_name,
    preview.last_name,
    preview.player_id,
  );
  const seasons =
    preview.first_season === null || preview.last_season === null
      ? null
      : `${preview.first_season} to ${preview.last_season}`;
  const games = `${preview.games_played} ${
    preview.games_played === 1 ? "game" : "games"
  }`;

  return (
    <div className={styles.preview}>
      <p className={styles.kicker}>
        {preview.scope === "playoffs" ? "Playoffs" : "Regular season"}
      </p>
      <p className={styles.headline}>
        <Link to={`/players/${preview.player_id}`} state={state}>
          {name}
        </Link>
      </p>
      <p className={styles.meta}>
        {seasons === null ? null : <>{seasons} · </>}
        {games}
      </p>
      <Figures
        figures={[
          ["MIN", "Minutes per game", formatAverage(preview.minutes_per_game)],
          ["PTS", "Points per game", formatAverage(preview.points_per_game)],
          [
            "REB",
            "Rebounds per game",
            formatAverage(preview.rebounds_per_game),
          ],
          ["AST", "Assists per game", formatAverage(preview.assists_per_game)],
          [
            "FG%",
            "Field goal percentage",
            formatPercentage(preview.field_goal_pct),
          ],
          [
            "3P%",
            "Three-point percentage",
            formatPercentage(preview.three_point_pct),
          ],
          [
            "FT%",
            "Free throw percentage",
            formatPercentage(preview.free_throw_pct),
          ],
        ]}
      />
    </div>
  );
}
