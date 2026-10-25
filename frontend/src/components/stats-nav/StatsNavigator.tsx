import { useEffect, useRef } from "react";

import { Button } from "../ui/Button";
import { LevelLink } from "./LevelLink";
import { SeasonLevel } from "./SeasonLevel";
import styles from "./StatsNav.module.css";
import { TeamLevel, TeamName } from "./TeamLevel";
import type { StatsLevel, StatsNavAdapter } from "./types";

export type { Conference, StatsLevel, StatsNavAdapter } from "./types";

export interface StatsNavigatorProps {
  /** Non-empty; the last level is the one shown. */
  stack: StatsLevel[];
  /** Push a level (a standings team). */
  open(level: StatsLevel): void;
  /** Swap the top level (a conference tab, an opponent). */
  replace(level: StatsLevel): void;
  /** Keep the first `toDepth` levels. */
  pop(toDepth: number): void;
  adapter: StatsNavAdapter;
}

/** A level's name in the breadcrumb: the season, or the team. */
function levelName(level: StatsLevel) {
  return level.kind === "season" ? (
    level.season
  ) : (
    <TeamName teamId={level.teamId} season={level.season} />
  );
}

/**
 * The stats navigator (FRONTEND-018): a stack of levels shown as a
 * breadcrumb ("Stats path"), a Back control when the stack is deeper than
 * one, and the top level's heading and view. It is router-agnostic: the
 * caller owns the stack and turns `open`, `replace` and `pop` into a route
 * (the Stats page) or state (the compose picker), and its adapter says how a
 * game, a player or a level is linked.
 *
 * Its parts are laid out by the caller's column (the Stats page's tab).
 *
 * Focus: when a control here opens or pops a level, focus moves to the new
 * level's heading (tabIndex -1), as the control it was on is gone. A change
 * from outside (a cold load, the browser's Back, a conference tab) moves none.
 */
export function StatsNavigator({
  stack,
  open,
  replace,
  pop,
  adapter,
}: StatsNavigatorProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const top = stack[stack.length - 1];
  const key = JSON.stringify(stack);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    heading.current?.focus();
  }, [key]);

  function move(change: () => void): void {
    moved.current = true;
    change();
  }

  const onTeam = (teamId: number, how: typeof open) =>
    move(() => how({ kind: "team", season: top.season, teamId }));

  return (
    <>
      <div className={styles.bar}>
        <nav aria-label="Stats path">
          <ol>
            {stack.map((level, index) => (
              <li key={index}>
                {index === stack.length - 1 ? (
                  <span aria-current="location">{levelName(level)}</span>
                ) : (
                  <LevelLink
                    level={level}
                    adapter={adapter}
                    onGo={() => move(() => pop(index + 1))}
                  >
                    {levelName(level)}
                  </LevelLink>
                )}
              </li>
            ))}
          </ol>
        </nav>
        {stack.length > 1 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => move(() => pop(stack.length - 1))}
          >
            Back
          </Button>
        ) : null}
      </div>

      <h2 ref={heading} tabIndex={-1}>
        {top.kind === "season" ? (
          `${top.season} season`
        ) : (
          <>
            {levelName(top)}, {top.season}
          </>
        )}
      </h2>

      {top.kind === "season" ? (
        <SeasonLevel
          level={top}
          adapter={adapter}
          onConference={(conf) => replace({ ...top, conf })}
          onTeam={(teamId) => onTeam(teamId, open)}
        />
      ) : (
        <TeamLevel
          level={top}
          adapter={adapter}
          onTeam={(teamId) => onTeam(teamId, replace)}
        />
      )}
    </>
  );
}
