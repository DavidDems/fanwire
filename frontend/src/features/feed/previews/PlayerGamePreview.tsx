import { Link } from "react-router-dom";

import type { components } from "../../../api/schema";
import { useDetailLinkState } from "../../../routes/modal-flow";
import { Figures } from "./Figures";
import {
  formatDate,
  formatMadeAttempted,
  formatMinutes,
  gameLabel,
  playerName,
} from "./format";
import styles from "./Previews.module.css";

type PlayerGamePreviewView = components["schemas"]["PlayerGamePreviewView"];

/**
 * A `player_game` data link on a post card (`FRONTEND-014`): the player, their
 * team, the opponent, the result and the date, then their line. A did-not-play
 * shows its reason in place of figures the source does not have. Its one link
 * opens the game with this line marked (`/games/<game_id>?line=<line_id>`);
 * the player is not linked separately.
 */
export function PlayerGamePreview({
  preview,
}: {
  preview: PlayerGamePreviewView;
}) {
  const state = useDetailLinkState();
  const name = playerName(
    preview.first_name,
    preview.last_name,
    preview.player_id,
  );
  const { team_score: teamScore, opponent_score: opponentScore } = preview;
  const result =
    teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : null;
  const label = gameLabel(preview.label);
  const seconds = preview.dnp_reason === null ? preview.seconds_played : null;

  return (
    <div className={styles.preview}>
      {label === "" ? null : <p className={styles.kicker}>{label}</p>}
      <p className={styles.headline}>
        <Link
          to={`/games/${preview.game_id}?line=${preview.line_id}`}
          state={state}
        >
          {name} {preview.is_home ? "vs" : "at"} {preview.opponent.name}
        </Link>
      </p>
      <p className={styles.meta}>
        {preview.team.name} ·{" "}
        {/* The result in a letter and a word, never by colour alone. */}
        {result === null ? null : (
          <>
            <abbr title={result === "W" ? "Won" : "Lost"}>{result}</abbr>{" "}
          </>
        )}
        <span className={styles.score}>
          {teamScore}–{opponentScore}
        </span>{" "}
        · <time dateTime={preview.date}>{formatDate(preview.date)}</time>
      </p>
      {seconds === null ? (
        <p className={styles.dnp}>
          {preview.dnp_reason === null || preview.dnp_reason === ""
            ? "Did not play"
            : `Did not play: ${preview.dnp_reason}`}
        </p>
      ) : (
        <Figures
          figures={[
            ["MIN", "Minutes", formatMinutes(seconds)],
            ["PTS", "Points", String(preview.points)],
            ["REB", "Rebounds", String(preview.rebounds)],
            ["AST", "Assists", String(preview.assists)],
            [
              "FG",
              "Field goals made-attempted",
              formatMadeAttempted(
                preview.field_goals_made,
                preview.field_goals_attempted,
              ),
            ],
            [
              "3P",
              "Three-pointers made-attempted",
              formatMadeAttempted(
                preview.three_pointers_made,
                preview.three_pointers_attempted,
              ),
            ],
            [
              "FT",
              "Free throws made-attempted",
              formatMadeAttempted(
                preview.free_throws_made,
                preview.free_throws_attempted,
              ),
            ],
          ]}
        />
      )}
    </div>
  );
}
