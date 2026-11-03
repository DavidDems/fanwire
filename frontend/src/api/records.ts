import { ok } from "./ok";
import { queryOptions } from "@tanstack/react-query";

import { apiClient } from "./client";
import type { components } from "./schema";

/**
 * The records reads ([[0x02-events]] "Records", `EVENTS-010`, split by
 * `EVENTS-012`) and the cache keys their answers live under, for the Records
 * tab and the stats navigator's records levels. Every type is an alias of the
 * generated schema, and all HTTP goes through `api/client.ts`.
 *
 * **Three reads.** `GET /events/records` is the catalog (every record, no
 * holder); `GET /events/records/holders?ids=` the holders of up to 24
 * records, asked with the ids sorted so the same set is the same edge cache
 * entry; `GET /events/records/{record_id}` one record's list.
 *
 * **Freshness.** The routes are cached five minutes at the edge and the data
 * changes once a day at most, so every read is fresh forever
 * (`staleTime: Infinity`, on the query options themselves): returning to a
 * records screen asks nothing.
 *
 * **One call per list.** A record's list holds at most its top 100, so it is
 * asked for once at `limit=100`, and no read sends `offset`.
 */

export type RecordsCatalogOut = components["schemas"]["RecordsCatalogOut"];
export type RecordCatalogItemOut =
  components["schemas"]["RecordCatalogItemOut"];
export type RecordHoldersOut = components["schemas"]["RecordHoldersOut"];
export type RecordHolderOut = components["schemas"]["RecordHolderOut"];
export type RecordListOut = components["schemas"]["RecordListOut"];
export type RecordEntryOut = components["schemas"]["RecordEntryOut"];
export type RecordGroup = RecordCatalogItemOut["group"];
export type RecordCategory = RecordCatalogItemOut["category"];
/** What a record's value is, and which of an entry's figures it fills (EVENTS-011). */
export type RecordValueKind = RecordCatalogItemOut["value_kind"];

/** The whole list in one call (a list holds at most 100). */
export const RECORD_LIMIT = 100;

/** The most records one holders read may name. */
export const HOLDERS_CAP = 24;

export const RECORDS_KEY = ["events", "records"] as const;

export function recordKey(id: string) {
  return ["events", "records", id] as const;
}

/** The ids sorted and without repeats: one set, one request, one key. */
function sortedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/** One key per set of ids, whatever their order. */
export function recordHoldersKey(ids: readonly string[]) {
  return ["events", "record-holders", sortedIds(ids).join(",")] as const;
}

/** The catalog: every record, team records first, and the data window. */
export async function fetchRecords(): Promise<RecordsCatalogOut> {
  return ok(await apiClient.GET("/events/records"), "/events/records");
}

/** The holders of `ids` (1 to 24 known ids), asked once with them sorted. */
export async function fetchRecordHolders(
  ids: readonly string[],
): Promise<RecordHoldersOut> {
  return ok(
    await apiClient.GET("/events/records/holders", {
      params: { query: { ids: sortedIds(ids).join(",") } },
    }),
    "/events/records/holders",
  );
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

export function recordHoldersQuery(ids: readonly string[]) {
  return queryOptions({
    queryKey: recordHoldersKey(ids),
    queryFn: () => fetchRecordHolders(ids),
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
