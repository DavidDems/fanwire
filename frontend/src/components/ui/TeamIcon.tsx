import { teamColors } from "../../lib/teamColors";
import styles from "./TeamIcon.module.css";

export interface TeamIconProps {
  /** The stored abbreviation (BOS). Unknown or missing: the neutral form. */
  abbreviation: string | null | undefined;
  /** 32 px or 64 px. */
  size: "sm" | "lg";
  /**
   * The team's name, only where the icon stands alone: it is then an image
   * named by it. Without it the icon is hidden, as the team is adjacent text.
   */
  label?: string;
}

/**
 * A team's code-drawn icon (FRONTEND-031): its abbreviation in black on the
 * team's inner colour, inside a ring of its outer colour. Text and CSS only.
 */
export function TeamIcon({ abbreviation, size, label }: TeamIconProps) {
  const colors = teamColors(abbreviation);
  const classes = [styles.icon, styles[size]];
  if (colors !== null)
    classes.push(
      styles.team,
      styles[`in-${colors.inner}`],
      styles[`out-${colors.outer}`],
    );
  return (
    <span
      className={classes.join(" ")}
      {...(label === undefined
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
    >
      {abbreviation ?? ""}
    </span>
  );
}
