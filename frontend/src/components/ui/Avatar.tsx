import type { CSSProperties } from "react";

import type { InnerColorKey, OuterColorKey } from "../../lib/teamColors";
import { mediaUrl } from "../../lib/mediaUrl";
import styles from "./Avatar.module.css";

export interface AvatarProps {
  username: string;
  size: "sm" | "lg";
  /** An inner palette key (USERS-005): the fill, with black text. */
  avatarInnerColor?: InnerColorKey | null;
  /** An outer palette key (USERS-005): a ring. */
  avatarOuterColor?: OuterColorKey | null;
  pictureKey?: string | null;
}

/**
 * The colour rule, one for every surface (USERS-005). The values are the
 * FRONTEND-031 palette tokens by name: an inner colour fills the circle and
 * its text is the palette's black (4.5:1 or more on every inner colour); an
 * outer colour is a ring, and with no inner the text keeps the default.
 * Neither: no inline style at all, so the default is exactly as before.
 */
function colourStyle(
  inner: InnerColorKey | null,
  outer: OuterColorKey | null,
): CSSProperties | undefined {
  if (inner === null && outer === null) return undefined;
  return {
    ...(inner === null
      ? {}
      : {
          backgroundColor: `var(--team-inner-${inner})`,
          color: "var(--team-outer-black)",
        }),
    ...(outer === null ? {} : { borderColor: `var(--team-outer-${outer})` }),
  };
}

/**
 * The username's first character, as typed, on the chosen colours; or the
 * profile picture, unchanged, when there is one. Decorative: its adjacent
 * username is the label.
 */
export function Avatar({
  username,
  size,
  avatarInnerColor = null,
  avatarOuterColor = null,
  pictureKey = null,
}: AvatarProps) {
  const initial = Array.from(username)[0] ?? "";
  const coloured = pictureKey === null;
  const ring = coloured && avatarOuterColor !== null;
  return (
    <span
      aria-hidden="true"
      className={[styles.avatar, styles[size], ...(ring ? [styles.ring] : [])].join(" ")}
      style={coloured ? colourStyle(avatarInnerColor, avatarOuterColor) : undefined}
    >
      {pictureKey !== null ? (
        <img className={styles.picture} src={mediaUrl(pictureKey)} alt="" />
      ) : (
        initial
      )}
    </span>
  );
}
