/**
 * FRONTEND-019: the records reads, `src/api/records.ts` (criterion 6).
 *
 * The interface this file pins:
 *
 * ```ts
 * type RecordsSummaryOut, RecordSummaryOut, RecordListOut, RecordEntryOut  // schema aliases
 * const RECORDS_KEY: readonly unknown[];          // GET /events/records
 * function recordKey(id: string): readonly unknown[]; // GET /events/records/{id}
 * const RECORD_LIMIT = 100;                       // one call shows the whole list (R11)
 * function fetchRecords(): Promise<RecordsSummaryOut>;
 * function fetchRecord(id: string): Promise<RecordListOut | null>; // null: the API's 404
 * function recordsQuery(): queryOptions;          // key RECORDS_KEY, staleTime Infinity
 * function recordQuery(id: string): queryOptions; // key recordKey(id), staleTime Infinity
 * ```
 *
 * - **Freshness.** Both query options carry `staleTime: Infinity` themselves
 *   (Prompt 20 R7: the routes are cached five minutes at the edge and the
 *   data changes once a day at most), so a return to a records screen asks
 *   nothing whatever the client's default.
 * - **One call per list.** `fetchRecord` asks `limit=100` and never sends
 *   `offset`; `fetchRecords` sends no query at all.
 * - All HTTP goes through `api/client.ts` (msw sees the real client).
 * - **EVENTS-011.** Each record carries `value_kind` (count, win_loss,
 *   made_total, shot_pct, average), and each entry and holder the nullable
 *   `wins`, `losses`, `made`, `attempted` and `pct`, passed through as the
 *   API sends them; the types come from the regenerated `schema.d.ts`.
 */
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import {
  VALUE_KINDS,
  recordListStub,
  recordsSummaryStub,
  testRecordList,
  testRecordsSummary,
} from "../test/records";
import {
  RECORDS_KEY,
  RECORD_LIMIT,
  fetchRecord,
  fetchRecords,
  recordKey,
  recordQuery,
  recordsQuery,
  type RecordEntryOut,
  type RecordListOut,
  type RecordSummaryOut,
  type RecordsSummaryOut,
} from "./records";

describe("fetchRecords", () => {
  it("answers GET /events/records, asking no query", async () => {
    const summary = recordsSummaryStub();
    server.use(summary.handler);

    const answer: RecordsSummaryOut = await fetchRecords();

    expect(answer).toEqual(testRecordsSummary());
    expect(summary.requests).toHaveLength(1);
    expect([...summary.requests[0].query.keys()]).toEqual([]);
  });

  it("rejects on a failed answer", async () => {
    const summary = recordsSummaryStub();
    summary.fail();
    server.use(summary.handler);

    await expect(fetchRecords()).rejects.toThrow();
  });
});

describe("fetchRecord", () => {
  it("asks for one record's whole list at limit=100, and never sends offset", async () => {
    const list = recordListStub();
    server.use(list.handler);

    const answer: RecordListOut | null =
      await fetchRecord("player-points-game");

    expect(answer).toEqual(testRecordList("player-points-game"));
    expect(RECORD_LIMIT).toBe(100);
    expect(list.requests).toHaveLength(1);
    expect(list.requests[0].path).toEqual({ record_id: "player-points-game" });
    expect(list.requests[0].query.get("limit")).toBe("100");
    expect(list.requests[0].query.has("offset")).toBe(false);
    expect([...list.requests[0].query.keys()]).toEqual(["limit"]);
  });

  it("answers null for an unknown id (the API's 404)", async () => {
    server.use(recordListStub(() => null).handler);

    expect(await fetchRecord("no-such-record")).toBeNull();
  });

  it("rejects on a failed answer", async () => {
    const list = recordListStub();
    list.fail();
    server.use(list.handler);

    await expect(fetchRecord("team-best-season")).rejects.toThrow();
  });
});

describe("the query options", () => {
  it("are fresh forever: staleTime Infinity on both", () => {
    expect(recordsQuery().staleTime).toBe(Infinity);
    expect(recordQuery("team-best-season").staleTime).toBe(Infinity);
  });

  it("key the summary and each list apart, stably", () => {
    expect(recordsQuery().queryKey).toEqual(RECORDS_KEY);
    expect(recordQuery("team-best-season").queryKey).toEqual(
      recordKey("team-best-season"),
    );
    expect(recordKey("team-best-season")).toEqual(
      recordKey("team-best-season"),
    );
    expect(recordKey("team-best-season")).not.toEqual(
      recordKey("team-worst-season"),
    );
    expect(recordKey("team-best-season")).not.toEqual(RECORDS_KEY);
    expect(JSON.stringify(recordKey("player-points-game"))).toContain(
      "player-points-game",
    );
  });
});

describe("value_kind and the figures (EVENTS-011)", () => {
  it("pass a record's kind and an entry's figures through as sent", async () => {
    server.use(recordsSummaryStub().handler, recordListStub().handler);

    const summary = await fetchRecords();
    const best = summary.records.find(
      (record) => record.id === "team-best-season",
    );
    expect(best?.value_kind).toBe("win_loss");
    expect(best?.unit).toBe("record");
    expect(best?.holder).toMatchObject({
      value: 0.89,
      wins: 73,
      losses: 9,
      pct: 0.89,
      made: null,
      attempted: null,
    });

    const threes = await fetchRecord("player-threes-game");
    expect(threes?.value_kind).toBe("made_total");
    expect(threes?.entries[1]).toMatchObject({
      value: 12,
      made: 12,
      attempted: 21,
      pct: 0.571,
      wins: null,
      losses: null,
    });
  });

  it("type value_kind as the five kinds and the figures as nullable", () => {
    const kinds: RecordSummaryOut["value_kind"][] = [...VALUE_KINDS];
    const listKind: RecordListOut["value_kind"] = "made_total";
    const figures: Pick<
      RecordEntryOut,
      "wins" | "losses" | "made" | "attempted" | "pct"
    > = { wins: null, losses: null, made: 12, attempted: 21, pct: null };

    expect(kinds).toEqual([
      "count",
      "win_loss",
      "made_total",
      "shot_pct",
      "average",
    ]);
    expect(listKind).toBe("made_total");
    expect(figures.made).toBe(12);
  });
});
