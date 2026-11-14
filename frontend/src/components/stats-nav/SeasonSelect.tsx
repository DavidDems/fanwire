import { useId } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { Field, describeField } from "../FormField";
import { EmptyState } from "../ui/EmptyState";
import { InlineAlert } from "../ui/InlineAlert";
import { StatusLine } from "../ui/StatusLine";

/**
 * The season picker Seasons and Records > Seasonal share (FRONTEND-019): a
 * native select over `GET /events/seasons` (newest first). `season` is the
 * caller's season (the address's, or the newest); one the list does not hold
 * still shows. Router-agnostic like the navigator, whose chunk it shares.
 */
export function SeasonSelect({
  season,
  options,
  onPick,
}: {
  season: string | null;
  options: string[];
  onPick: (season: string) => void;
}) {
  const id = useId();
  return (
    <Field id={id} label="Season">
      <select
        {...describeField(id)}
        value={season ?? ""}
        disabled={options.length === 0}
        onChange={(event) => onPick(event.target.value)}
      >
        {season !== null && !options.includes(season) ? (
          <option value={season}>{season}</option>
        ) : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** What shows in a season's place while there is none to show. */
export function NoSeason({ seasons }: { seasons: UseQueryResult<string[]> }) {
  return seasons.isError ? (
    <InlineAlert>
      We could not load the seasons just now. Please try again.
    </InlineAlert>
  ) : seasons.isPending ? (
    <StatusLine>Loading the seasons…</StatusLine>
  ) : (
    <EmptyState>There are no seasons to show yet.</EmptyState>
  );
}
