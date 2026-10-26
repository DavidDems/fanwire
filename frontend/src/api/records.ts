import { queryOptions } from "@tanstack/react-query";

import { apiClient } from "./client";
import type { components } from "./schema";

/**
 * The records reads ([[0x02-events]] "Records", `EVENTS-010`) and the cache
 * keys their answers live under, for the Records tab and the stats
 * navigator's records levels. Every type is an alias of the generated schema,
 * and all HTTP goes through `api/client.ts`.
 *
 * **Freshness.** The routes are cached five minutes at the edge and the data
 * changes once a day at most, so both reads are fresh forever
 * (`staleTime: Infinity`, on the query options themselves): returning to a
 * records screen asks nothing.
 *
 * **One call per list.** A record's list holds at most its top 100, so it is
 * asked for once at `limit=100`, and no read sends `offset`.
 */

export type RecordsSummaryOut = components["schemas"]["RecordsSummaryOut"];
export type RecordSummaryOut = components["schemas"]["RecordSummaryOut"];
export type RecordHolderOut = components["schemas"]["RecordHolderOut"];
export type RecordListOut = components["schemas"]["RecordListOut"];
export type RecordEntryOut = components["schemas"]["RecordEntryOut"];
export type RecordGroup = RecordSummaryOut["group"];

/** The whole list in one call (a list holds at most 100). */
export const RECORD_LIMIT = 100;

export const RECORDS_KEY = ["events", "records"] as const;

export function recordKey(id: string) {
  return ["events", "records", id] as const;
}

/** An answer's data, or an error naming the request and its status. */
function ok<T>(
  { data, response }: { data?: T; response: Response },
  path: string,
): T {
  if (!response.ok || data === undefined)
    throw new Error(`GET ${path} answered ${response.status}`);
  return data;
}

/** Every record with its holder, team records first, and the data window. */
export async function fetchRecords(): Promise<RecordsSummaryOut> {
  return ok(await apiClient.GET("/events/records"), "/events/records");
}

/** One record's whole ranked list, or `null` for an unknown id (a 404). */
export async function fetchRecord(id: string): Promise<RecordListOut | null> {
  const answer = await apiClient.GET("/events/records/{record_id}", {
    params: { path: { record_id: id }, query: { limit: RECORD_LIMIT } },
  });
  return answer.response.status === 404
    ? null
    : ok(answer, `/events/records/${id}`);
}

export function recordsQuery() {
  return queryOptions({
    queryKey: RECORDS_KEY,
    queryFn: fetchRecords,
    staleTime: Infinity,
  });
}

export function recordQuery(id: string) {
  return queryOptions({
    queryKey: recordKey(id),
    queryFn: () => fetchRecord(id),
    staleTime: Infinity,
  });
}
