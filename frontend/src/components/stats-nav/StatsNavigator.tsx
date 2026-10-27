import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "../ui/Button";
import { LevelLink } from "./LevelLink";
import { SeasonLevel } from "./SeasonLevel";
import styles from "./StatsNav.module.css";
import { TeamLevel, TeamName } from "./TeamLevel";
import type { StatsLevel, StatsNavAdapter } from "./types";

export type {
  Conference,
  RecordGroup,
  StatsLevel,
  StatsNavAdapter,
} from "./types";

export interface LevelViews {
  name(level: StatsLevel): ReactNode;
  view(
    level: StatsLevel,
    controls: {
      open(level: StatsLevel): void;
      replace(level: StatsLevel): void;
    },
  ): ReactNode;
}

export interface StatsNavigatorProps {
  levelViews?: LevelViews;
  selectMode?: boolean;
  /** Non-empty; the last level is the one shown. */
  stack: StatsLevel[];
  /** Push a level (a standings team, a record). */
  open(level: StatsLevel): void;
  /** Swap the top level (a conference tab, an opponent, a records group). */
  replace(level: StatsLevel): void;
  /** Keep the first `toDepth` levels. */
  pop(toDepth: number): void;
  adapter: StatsNavAdapter;
}

/**
 * A level's name in the breadcrumb: the season, the team, the records'
 * group, or the record's title.
 */
function levelName(level: StatsLevel, views?: LevelViews) {
  switch (level.kind) {
    case "season":
      return level.season;
    case "team":
      return <TeamName teamId={level.teamId} season={level.season} />;
    default:
      return views?.name(level);
  }
}

/**
 * The stats navigator (FRONTEND-018): a stack of levels shown as a
 * breadcrumb ("Stats path"), a Back control when the stack is deeper than
 * one, and the top level's heading and view. It is router-agnostic: the
 * caller owns the stack and turns `open`, `replace` and `pop` into a route
 * (the Stats page) or state (the compose picker), and its adapter says how a
 * game, a player, a team or a level is linked.
 *
 * It draws season and team levels, and takes other names and views from
 * its caller: records on Stats, or game and player choices in the picker.
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
  levelViews,
  selectMode = false,
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

  function view() {
    switch (top.kind) {
      case "season":
        return (
          <SeasonLevel
            level={top}
            adapter={adapter}
            onConference={(conf) => replace({ ...top, conf })}
            onTeam={(teamId) =>
              move(() => open({ kind: "team", season: top.season, teamId }))
            }
          />
        );
      case "team":
        return (
          <TeamLevel
            level={top}
            adapter={adapter}
            onTeam={(teamId) =>
              move(() => replace({ kind: "team", season: top.season, teamId }))
            }
            onGame={
              selectMode
                ? (gameId) => move(() => open({ kind: "game", gameId }))
                : undefined
            }
          />
        );
      default:
        return levelViews?.view(top, {
          open: (level) => move(() => open(level)),
          replace,
        });
    }
  }

  return (
    <>
      <div className={styles.bar}>
        <nav aria-label="Stats path">
          <ol>
            {stack.map((level, index) => (
              <li key={index}>
                {index === stack.length - 1 ? (
                  <span aria-current="location">
                    {levelName(level, levelViews)}
                  </span>
                ) : (
                  <LevelLink
                    level={level}
                    adapter={adapter}
                    onGo={() => move(() => pop(index + 1))}
                  >
                    {levelName(level, levelViews)}
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
        ) : top.kind === "team" ? (
          <>
            {levelName(top, levelViews)}, {top.season}
          </>
        ) : (
          levelName(top, levelViews)
        )}
      </h2>

      {view()}
    </>
  );
}
