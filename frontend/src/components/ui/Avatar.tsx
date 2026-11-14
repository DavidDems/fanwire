import type { ReactNode } from "react";

import { config } from "../../config";
import styles from "./Avatar.module.css";

export interface AvatarProps {
  username: string;
  size: "sm" | "lg";
  avatarKey?: string | null;
  pictureKey?: string | null;
  exposeKey?: boolean;
}

export const AVATAR_OPTIONS = [
  ["court-lines", "Court lines"],
  ["ball-seams", "Ball seams"],
  ["shot-clock", "Shot clock"],
  ["scoreboard", "Scoreboard"],
  ["arc", "Arc"],
  ["net-grid", "Net grid"],
  ["baseline", "Baseline"],
  ["play-pattern", "Play pattern"],
] as const;

/** Code drawn, decorative identity mark; its adjacent username is the label. */
export function Avatar({
  username,
  size,
  avatarKey = null,
  pictureKey = null,
  exposeKey = true,
}: AvatarProps) {
  const initial = Array.from(username)[0] ?? "";
  const selectedKey = pictureKey === null ? avatarKey : null;
  return (
    <span
      aria-hidden="true"
      className={[styles.avatar, styles[size]].join(" ")}
      data-avatar-key={exposeKey ? selectedKey ?? undefined : undefined}
    >
      {pictureKey !== null ? (
        <img className={styles.picture} src={config.mediaBaseUrl + "/" + pictureKey} alt="" />
      ) : selectedKey === null ? initial : <AvatarGeometry avatarKey={selectedKey} />}
    </span>
  );
}

function AvatarGeometry({ avatarKey }: { avatarKey: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const };
  const drawings: Record<string, ReactNode> = {
    "court-lines": <path d="M10 4v40M4 24h40M10 12h8a12 12 0 0 1 0 24h-8" />,
    "ball-seams": <><circle cx="24" cy="24" r="19" /><path d="M11 9c8 8 13 18 13 30M37 9c-8 8-13 18-13 30" /></>,
    "shot-clock": <><path d="M24 7v17l12 8M17 3h14M24 3v4" /><circle cx="24" cy="26" r="19" /></>,
    scoreboard: <><rect x="5" y="9" width="38" height="30" rx="4" /><path d="M12 17h7v14h-7zm14 0h7v14h-7zM5 24h38" /></>,
    arc: <><path d="M5 42a19 19 0 0 1 38 0M24 42V29M17 42h14" /><circle cx="24" cy="23" r="3" /></>,
    "net-grid": <path d="M8 7h32M8 7v34m8-34v34m8-34v34m8-34v34m8-34v34M8 41h32" />,
    baseline: <><path d="M7 39h34M12 39V9h20v30M12 17h20M12 31h20" /><circle cx="22" cy="24" r="4" /></>,
    "play-pattern": <><path d="M8 36 20 12l12 24 9-24" /><circle cx="8" cy="36" r="3" /><circle cx="20" cy="12" r="3" /><circle cx="32" cy="36" r="3" /><circle cx="41" cy="12" r="3" /></>,
  };
  return <svg viewBox="0 0 48 48" className={styles.geometry} {...common}>{drawings[avatarKey]}</svg>;
}
