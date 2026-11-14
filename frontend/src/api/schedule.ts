import { queryOptions } from "@tanstack/react-query";

import { apiClient } from "./client";
import { ok } from "./ok";
import type { components } from "./schema";

/**
 * The schedule read ([[0x02b-events-loading]] "The schedule", `EVENTS-014`), for the
 * Schedule page (`FRONTEND-044`). In the pattern of `api/stats.ts`: every
 * type an alias of the generated schema, all HTTP through `api/client.ts`.
 *
 * **One read per season**, with no `date_from`/`date_to` window: the page
 * slices the season's games by day on the client, so moving between days of
 * a season asks nothing. **Fresh for five minutes**, so today's finished games
 * appear without a reload, and a return to a season already read is free.
 */

export type ScheduleOut = components["schemas"]["ScheduleOut"];
export type ScheduleGameOut = components["schemas"]["ScheduleGameOut"];

/** Five minutes: the most a finished game may wait to show as final. */
export const SCHEDULE_STALE_TIME = 300_000;

export function scheduleKey(season: string) {
  return ["events", "seasons", season, "schedule"] as const;
}

/**
 * A season's whole schedule. A 404 (a season with neither a game nor a
 * schedule row) is `null`, a season with no games; the generated contract
 * lists only 200 and 422, so the status is checked explicitly. Any other
 * failure throws.
 */
export async function fetchSchedule(
  season: string,
): Promise<ScheduleOut | null> {
  const answer = await apiClient.GET("/events/seasons/{season}/schedule", {
    params: { path: { season } },
  });
  return answer.response.status === 404
    ? null
    : ok(answer, `/events/seasons/${season}/schedule`);
}

export function scheduleQuery(season: string) {
  return queryOptions({
    queryKey: scheduleKey(season),
    queryFn: () => fetchSchedule(season),
    staleTime: SCHEDULE_STALE_TIME,
  });
}
