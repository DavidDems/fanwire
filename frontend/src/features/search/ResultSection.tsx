import { useId, type ReactNode } from "react";

import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";

/** What a section needs to know of its query. */
interface SectionQuery {
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

export interface ResultSectionProps {
  title: "Accounts" | "Posts";
  /** `2` on `/search`, `3` in the home page's rail, under its own h2. */
  level: 2 | 3;
  q: string;
  query: SectionQuery;
  /** How many rows `children` holds; none, once settled, is the empty state. */
  count: number;
  /** Offer Retry beside a failure (the rail, `FRONTEND-036`). */
  retry?: boolean;
  /** The rows. */
  children: ReactNode;
  /** What ends the section: Load more on `/search`, Show all in the rail. */
  footer: ReactNode;
}

/**
 * One section of search results, Accounts or Posts, on `/search` and in the
 * home page's rail alike: a section named by its heading, the shared loading,
 * failure and empty states (the empty one naming the query), the rows, then
 * the footer. Each section follows its own query only, so one failing never
 * touches the other.
 */
export function ResultSection({
  title,
  level,
  q,
  query,
  count,
  retry = false,
  children,
  footer,
}: ResultSectionProps) {
  const headingId = useId();
  const noun = title.toLowerCase();
  const Heading = `h${level}` as const;
  return (
    <section aria-labelledby={headingId}>
      <Heading id={headingId}>{title}</Heading>
      {query.isPending ? <StatusLine>Searching {noun}…</StatusLine> : null}
      {query.isError ? (
        <>
          <InlineAlert>
            We could not search {noun} just now. Please try again.
          </InlineAlert>
          {retry ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          ) : null}
        </>
      ) : null}
      {query.isPending || query.isError || count > 0 ? null : (
        <EmptyState>
          No {noun} match “{q}”.
        </EmptyState>
      )}
      {count > 0 ? children : null}
      {footer}
    </section>
  );
}
