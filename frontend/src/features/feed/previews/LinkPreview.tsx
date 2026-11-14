import type { PostView } from "../api";
import { GamePreview } from "./GamePreview";
import { PlayerCareerPreview } from "./PlayerCareerPreview";
import { PlayerGamePreview } from "./PlayerGamePreview";
import styles from "./Previews.module.css";

/**
 * A post's data link, as its card shows it (`FRONTEND-014`): one of the three
 * previews, picked by the preview's `type`. A link whose target has no preview
 * (`data_link` set, `data_link_preview` null) is a neutral "Stats unavailable",
 * never an empty box; a post with no link shows nothing.
 */
export function LinkPreview({ post }: { post: PostView }) {
  const preview = post.data_link_preview ?? null;
  if (preview === null) {
    return (post.data_link ?? null) === null ? null : (
      <p className={styles.unavailable}>Stats unavailable</p>
    );
  }
  switch (preview.type) {
    case "game_final":
      return <GamePreview preview={preview} />;
    case "player_game":
      return <PlayerGamePreview preview={preview} />;
    case "player_career":
      return <PlayerCareerPreview preview={preview} />;
  }
}
