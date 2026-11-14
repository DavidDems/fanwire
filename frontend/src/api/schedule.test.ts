/**
 * FRONTEND-044: the schedule read, `src/api/schedule.ts`, in the pattern of
 * `api/stats.ts` (every type an alias of the generated schema, all HTTP
 * through `api/client.ts`).
 *
 * The interface this file pins:
 *
 * - `ScheduleOut` and `ScheduleGameOut`, aliases of the schema's (the
 *   typecheck's to pin; used below).
 * - `scheduleKey(season)` = `["events", "seasons", season, "schedule"]`, next
 *   to the other season reads' keys.
 * - `fetchSchedule(season)`: `GET /events/seasons/{season}/schedule`, once,
 *   with no date window (one read per season, sliced on the client). A 404
 *   (a season with neither a game nor a schedule row) is `null`; any other
 *   failure throws.
 * - `scheduleQuery(season)`: `{ queryKey, queryFn, staleTime }`, its
 *   `staleTime` above 0 (moving between days of a season asks nothing) and at
 *   most five minutes (today's finished games appear).
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import {
  NOVEMBER_SCHEDULE,
  SCHEDULE_SEASON,
  scheduleStub,
} from "../test/schedule";
import {
  fetchSchedule,
  scheduleKey,
  scheduleQuery,
  type ScheduleGameOut,
  type ScheduleOut,
} from "./schedule";

function client(): QueryClient {
  // As the app's and the test kit's: staleTime 0 by default.
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("the schedule read", () => {
  it("keys a season's schedule beside the other season reads", () => {
    expect(scheduleKey("2026-27")).toEqual([
      "events",
      "seasons",
      "2026-27",
      "schedule",
    ]);
  });

  it("scheduleQuery carries the key, a fetcher and a staleTime above 0 and at most five minutes", () => {
    const options = scheduleQuery("2026-27");

    expect(options.queryKey).toEqual(scheduleKey("2026-27"));
    expect(typeof options.queryFn).toBe("function");
    expect(Number(options.staleTime)).toBeGreaterThan(0);
    expect(Number(options.staleTime)).toBeLessThanOrEqual(300_000);
  });

  it("fetchSchedule reads the season's whole schedule once, with no date window", async () => {
    const stub = scheduleStub();
    server.use(stub.handler);

    const answer: ScheduleOut | null = await fetchSchedule(SCHEDULE_SEASON);

    expect(answer).toEqual(NOVEMBER_SCHEDULE);
    const games: ScheduleGameOut[] = answer?.games ?? [];
    expect(games.map((game) => game.status)).toContain("scheduled");
    expect(stub.seasons()).toEqual([SCHEDULE_SEASON]);
    expect(stub.requests[0].query.has("date_from")).toBe(false);
    expect(stub.requests[0].query.has("date_to")).toBe(false);
  });

  it("a season the API has none of (404) is null, not an error", async () => {
    server.use(scheduleStub({}).handler);

    await expect(fetchSchedule("1999-00")).resolves.toBeNull();
    await expect(
      client().fetchQuery(scheduleQuery("1999-00")),
    ).resolves.toBeNull();
  });

  it("any other failure throws", async () => {
    const stub = scheduleStub();
    stub.fail();
    server.use(stub.handler);

    await expect(fetchSchedule(SCHEDULE_SEASON)).rejects.toThrow(/500/);
  });

  it("a second read of the same season within the staleTime asks nothing; another season reads once", async () => {
    const stub = scheduleStub((season) => ({ season, games: [] }));
    server.use(stub.handler);
    const queries = client();

    for (let round = 0; round < 2; round += 1) {
      const answer = await queries.fetchQuery(scheduleQuery("2026-27"));
      expect(answer?.season).toBe("2026-27");
    }
    await queries.fetchQuery(scheduleQuery("2025-26"));

    expect(stub.seasons()).toEqual(["2026-27", "2025-26"]);
  });
});
