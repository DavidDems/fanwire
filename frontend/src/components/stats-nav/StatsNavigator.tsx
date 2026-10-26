import { useEffect, useRef } from "react";

import { Button } from "../ui/Button";
import { LevelLink } from "./LevelLink";
import { groupTitle } from "./recordLabels";
import { RecordLevel, RecordTitle } from "./RecordLevel";
import { RecordsLevel } from "./RecordsLevel";
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

export interface StatsNavigatorProps {
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
function levelName(level: StatsLevel) {
  switch (level.kind) {
    case "season":
      return level.season;
    case "team":
      return <TeamName teamId={level.teamId} season={level.season} />;
    case "records":
      return groupTitle(level.group);
    case "record":
      return <RecordTitle id={level.id} />;
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
 * Its levels are a season and a team's season (Seasons), and a group's
 * record cards and a record's list (Records, FRONTEND-019).
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
          />
        );
      case "records":
        return (
          <RecordsLevel
            level={top}
            adapter={adapter}
            onGroup={(group) => replace({ kind: "records", group })}
            onRecord={(id) => move(() => open({ kind: "record", id }))}
          />
        );
      case "record":
        return <RecordLevel level={top} adapter={adapter} />;
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
        ) : top.kind === "team" ? (
          <>
            {levelName(top)}, {top.season}
          </>
        ) : (
          levelName(top)
        )}
      </h2>

      {view()}
    </>
  );
}
