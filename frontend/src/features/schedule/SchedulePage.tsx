import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  scheduleQuery,
  type ScheduleGameOut,
  type ScheduleOut,
} from "../../api/schedule";
import { Button } from "../../components/ui/Button";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { Skeleton } from "../../components/ui/Skeleton";
import { useMediaQuery } from "../../routes/useMediaQuery";
import { GameCard } from "../games/GameCard";
import {
  addDays,
  dayLabel,
  dayOfGame,
  easternStartTime,
  easternToday,
  parseDay,
  seasonOf,
  shortDay,
} from "./days";
import styles from "./SchedulePage.module.css";

/** The shell's own breakpoints (`layout.md` §2): 5 cells, then 3, then 1. */
const FIVE_CELLS = "(min-width: 78em)";
const THREE_CELLS = "(min-width: 53.75em)";

type SeasonResult = UseQueryResult<ScheduleOut | null>;

/**
 * The Schedule page (`FRONTEND-044`): a row of day cells, 5 from 78em, 3 from
 * 53.75em, 1 below, the middle one the centre day and the others the days
 * either side of it in order. The cell count is chosen in JavaScript
 * (`useMediaQuery`), so a phone renders one cell, not five hidden by CSS.
 *
 * **The centre day is in the address.** No `?date=` is today in US Eastern
 * time (the zone game dates are stored in), whatever the viewer's own zone;
 * a real `?date=YYYY-MM-DD` centres that day, anything else is today. A move
 * replaces the entry rather than pushing one, so Back leaves the page instead
 * of stepping through every day visited, and returning to today drops the
 * parameter.
 *
 * **One read per season shown** (`api/schedule.ts`), sliced into days here: a
 * day belongs to the season starting that year from 1 August. A season the
 * API has no schedule for (404) is a season with no games; any other failure
 * is one alert with a Retry, however many seasons failed.
 *
 * A final game is the shared `GameCard` as Recent Games renders it, one link
 * opening the game in the detail modal over this page; a game not played yet
 * is the same card with its Eastern start time and no link.
 */
export function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const today = easternToday();
  const centre = parseDay(params.get("date")) ?? today;
  const five = useMediaQuery(FIVE_CELLS);
  const three = useMediaQuery(THREE_CELLS);
  const reach = five ? 2 : three ? 1 : 0;
  const days = Array.from({ length: 2 * reach + 1 }, (_, index) =>
    addDays(centre, index - reach),
  );
  const seasons = [...new Set(days.map(seasonOf))];
  const results = useQueries({ queries: seasons.map(scheduleQuery) });
  const bySeason = new Map(
    seasons.map((season, index) => [season, results[index]]),
  );
  const failed = results.filter((result) => result.isError);
  const [announcement, setAnnouncement] = useState("");

  function move(day: string) {
    setParams(day === today ? {} : { date: day }, { replace: true });
    const label = dayLabel(day, today);
    const date = shortDay(day);
    setAnnouncement(label === date ? date : `${label}, ${date}`);
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Schedule</h1>
      <div className={styles.controls}>
        <Button
          variant="secondary"
          size="md"
          onClick={() => move(addDays(centre, -1))}
        >
          <span aria-hidden="true">‹ </span>Previous day
        </Button>
        {centre === today ? null : (
          <Button variant="ghost" size="md" onClick={() => move(today)}>
            Today
          </Button>
        )}
        <Button
          variant="secondary"
          size="md"
          onClick={() => move(addDays(centre, 1))}
        >
          Next day<span aria-hidden="true"> ›</span>
        </Button>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {failed.length === 0 ? null : (
        <div className={styles.failure}>
          <InlineAlert>The schedule could not be loaded.</InlineAlert>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              for (const result of failed) void result.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      <div className={`${styles.days} ${styles[`days${days.length}`]}`}>
        {days.map((day) => (
          <DayCell
            key={day}
            day={day}
            label={dayLabel(day, today)}
            isToday={day === today}
            isCentre={day === centre}
            result={bySeason.get(seasonOf(day))}
            onSelect={() => move(day)}
          />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  day,
  label,
  isToday,
  isCentre,
  result,
  onSelect,
}: {
  day: string;
  label: string;
  isToday: boolean;
  isCentre: boolean;
  result: SeasonResult | undefined;
  onSelect: () => void;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={isCentre ? `${styles.cell} ${styles.centre}` : styles.cell}
    >
      <h2 id={headingId} className={styles.dayHeading}>
        <button
          type="button"
          className={styles.dayButton}
          aria-current={isToday ? "date" : undefined}
          onClick={onSelect}
        >
          {label}
        </button>
      </h2>
      <DayGames day={day} result={result} />
    </section>
  );
}

function DayGames({
  day,
  result,
}: {
  day: string;
  result: SeasonResult | undefined;
}) {
  if (result === undefined || result.isError) return null;
  if (result.isPending) {
    return (
      <div role="status" aria-label="Loading games">
        <Skeleton variant="line" />
      </div>
    );
  }
  const games = (result.data?.games ?? []).filter(
    (game) => dayOfGame(game.date) === day,
  );
  if (games.length === 0) return <p className={styles.empty}>No games</p>;
  return (
    <ul className={styles.games}>
      {games.map((game) => (
        <li key={game.nba_game_id}>
          <ScheduleCard game={game} season={result.data?.season ?? ""} />
        </li>
      ))}
    </ul>
  );
}

/** A final game links to its page; a game not played yet shows its start. */
function ScheduleCard({
  game,
  season,
}: {
  game: ScheduleGameOut;
  season: string;
}) {
  const final =
    game.status === "final" &&
    game.game_id !== null &&
    game.away_score !== null &&
    game.home_score !== null;
  if (final) {
    return (
      <GameCard
        to={`/games/${game.game_id}?${new URLSearchParams({ season }).toString()}`}
        away={{ team: game.away_team, score: game.away_score ?? undefined }}
        home={{ team: game.home_team, score: game.home_score ?? undefined }}
      />
    );
  }
  return (
    <GameCard
      away={{ team: game.away_team }}
      home={{ team: game.home_team }}
      time={game.time_tbd ? "Time TBD" : easternStartTime(game.date)}
    />
  );
}
