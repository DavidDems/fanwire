import type { MouseEvent, ReactNode } from "react";

import styles from "./StatsNav.module.css";
import type { StatsLevel, StatsNavAdapter } from "./types";

/**
 * A control that opens or returns to a level: a link to the level's address
 * when the adapter gives one (a plain click calls `onGo` instead of loading
 * it; a modified click opens it as any link), else a button. `label`, when
 * given, is its accessible name, for a control whose text says less (a
 * record card's View all).
 */
export function LevelLink({
  level,
  adapter,
  onGo,
  label,
  children,
}: {
  level: StatsLevel;
  adapter: StatsNavAdapter;
  onGo: () => void;
  label?: string;
  children: ReactNode;
}) {
  const href = adapter.levelHref?.(level);
  if (href === undefined)
    return (
      <button
        type="button"
        className={styles.control}
        aria-label={label}
        onClick={onGo}
      >
        {children}
      </button>
    );

  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    if (
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onGo();
  }

  return (
    <a href={href} aria-label={label} onClick={handleClick}>
      {children}
    </a>
  );
}
