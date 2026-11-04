import type { RecordCatalogItemOut } from "../../api/records";
import type { RecordsBar } from "./types";

/** How many cards a page of results shows, and Load more adds (FRONTEND-030). */
export const PAGE_SIZE = 24;

/** A query's terms: split on whitespace, lower case, none empty. */
export function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Whether a record holds every term, case-insensitive, as a substring of its
 * title, category, group, unit or one of its keywords. No terms match all.
 */
export function matchesTerms(
  record: RecordCatalogItemOut,
  terms: readonly string[],
): boolean {
  const fields = [
    record.title,
    record.category,
    record.group,
    record.unit,
    ...record.keywords,
  ].map((field) => field.toLowerCase());
  return terms.every((term) => fields.some((field) => field.includes(term)));
}

/**
 * The records a bar shows for a query, in order. With no query, Top records
 * is the catalog's featured records by `featured_rank`, and a group its whole
 * library in catalog order; a query searches the whole library on Top
 * records, and that group's on a group.
 */
export function barRecords(
  records: readonly RecordCatalogItemOut[],
  bar: RecordsBar,
  query: string,
): RecordCatalogItemOut[] {
  const terms = queryTerms(query);
  if (bar === "top" && terms.length === 0)
    return records
      .filter((record) => record.featured_rank !== null)
      .sort((a, b) => (a.featured_rank ?? 0) - (b.featured_rank ?? 0));
  return records.filter(
    (record) =>
      (bar === "top" || record.group === bar) && matchesTerms(record, terms),
  );
}
