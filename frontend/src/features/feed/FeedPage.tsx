import { useInfiniteQuery } from "@tanstack/react-query";

import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatusLine } from "../../components/ui/StatusLine";
import styles from "./FeedPage.module.css";
import { PostNode } from "./PostNode";
import { FEED_PAGES_KEY, fetchFeedPage } from "./api";

/** Three post-shaped placeholders: enough to read as a feed arriving, not a count. */
const SKELETONS = [0, 1, 2] as const;

/**
 * `/` — the feed.
 *
 * **One request, whoever is asking.** A visitor with no session and a signed-in
 * member issue the same `GET /feed`; the backend decides what belongs in it and
 * this page renders what came back ([[0x06-feed]]). There is deliberately no
 * branch here on who the reader is: duplicating a decision the API already made
 * would leave two answers to drift apart the first time the server's own
 * changes, and the drift would be invisible from this side.
 * `feed-isolation.test.ts`
 * holds this file to that from disk.
 *
 * **Paging is keyed off `next_before_id`, not a count.** The response says
 * whether there is another page, and `null` is the whole of "stop" — counting
 * the items would be wrong the first time view assembly drops a post whose
 * author was soft-deleted, which is a case the route is explicitly built to
 * survive ([[0x06-feed]] Routes).
 *
 * **It is an explicit control rather than a scroll sentinel.** jsdom implements
 * no `IntersectionObserver` and `src/setupTests.ts` — the only place a polyfill
 * could live — is outside this unit's permitted paths, so a scroll-triggered
 * fetch would be untestable from inside the unit that owns it. Which page is
 * asked for, and when the asking stops, is a property of the request; the
 * gesture that starts it can be revisited without touching either.
 */
export function FeedPage() {
  const feed = useInfiniteQuery({
    queryKey: FEED_PAGES_KEY,
    queryFn: ({ pageParam }) => fetchFeedPage(pageParam),
    // The newest posts are what no cursor means; an invented starting id would
    // silently skip everything after it.
    initialPageParam: null as number | null,
    // `next_before_id` straight through: `null` is react-query's own "no further
    // page", so there is nothing here to keep in step with the server.
    getNextPageParam: (lastPage) => lastPage.next_before_id,
  });

  const items = (feed.data?.pages ?? []).flatMap((page) => page.items);

  return (
    <section className={styles.page}>
      <h1>Feed</h1>

      {feed.isPending ? (
        <div className={styles.loading}>
          <StatusLine>Loading the feed…</StatusLine>
          {SKELETONS.map((index) => (
            <Skeleton key={index} variant="post" />
          ))}
        </div>
      ) : null}
      {feed.isError ? (
        <InlineAlert>
          We could not load the feed just now. Please try again.
        </InlineAlert>
      ) : null}
      {feed.isSuccess && items.length === 0 ? (
        <EmptyState>There is nothing here yet.</EmptyState>
      ) : null}

      {/*
       * Not rendered while there is nothing in it: an empty list is announced
       * as "list, 0 items", which says less than the status line above it.
       */}
      {items.length === 0 ? null : (
        <ol className={styles.stream}>
          {items.map((post) => (
            <li key={post.id}>
              <PostNode post={post} />
            </li>
          ))}
        </ol>
      )}

      {/*
       * Absent rather than disabled once the feed has ended: a permanently
       * inert control is something a reader keeps trying, and there is no
       * further page for it to ever become enabled for.
       */}
      {!feed.hasNextPage ? null : (
        <Button
          type="button"
          variant="secondary"
          size="md"
          className={styles.more}
          onClick={() => void feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
        >
          Load more
        </Button>
      )}
    </section>
  );
}
