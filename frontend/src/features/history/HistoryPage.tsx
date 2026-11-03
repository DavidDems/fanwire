import { useInfiniteQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatusLine } from "../../components/ui/StatusLine";
import { PreparedPostNode } from "../feed/PreparedPostNode";
import { fetchHistoryPage, historyKey, type HistoryTab } from "./api";
import styles from "./HistoryPage.module.css";

const TABS = [
  { id: "posts", label: "Posts" },
  { id: "replies", label: "Replies" },
  { id: "likes", label: "Likes" },
  { id: "reposts", label: "Reposts" },
];

const EMPTY = {
  posts: "You have no posts yet.",
  replies: "You have no replies yet.",
  likes: "You have not liked any posts yet.",
  reposts: "You have not reposted anything yet.",
};

function selectedTab(value: string | null): HistoryTab {
  return value === "replies" || value === "likes" || value === "reposts"
    ? value
    : "posts";
}

/** Private activity, cached separately per URL-selected tab. */
export function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const tab = selectedTab(params.get("tab"));
  const history = useInfiniteQuery({
    queryKey: historyKey(tab),
    queryFn: ({ pageParam }) => fetchHistoryPage(tab, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
    staleTime: 30_000,
  });
  const items = (history.data?.pages ?? []).flatMap((page) => page.items);

  return (
    <section className={styles.page}>
      <h1>History</h1>
      <SegmentedTabs
        label="History"
        tabs={TABS}
        value={tab}
        onChange={(next) => {
          const query = new URLSearchParams(params);
          query.set("tab", next);
          setParams(query);
        }}
      >
        <div className={styles.content}>
          {history.isPending ? (
            <>
              <StatusLine>Loading your history…</StatusLine>
              <Skeleton variant="post" />
            </>
          ) : null}
          {history.isError ? (
            <>
              <InlineAlert>
                We could not load your history just now. Please try again.
              </InlineAlert>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => void history.refetch()}
                disabled={history.isFetching}
              >
                Retry
              </Button>
            </>
          ) : null}
          {history.isSuccess && items.length === 0 ? (
            <EmptyState>{EMPTY[tab]}</EmptyState>
          ) : null}
          {items.length > 0 ? (
            <ol className={styles.stream}>
              {items.map((post) => (
                <li key={post.id}>
                  <PreparedPostNode key={`${tab}-${post.id}`} post={post} />
                </li>
              ))}
            </ol>
          ) : null}
          {history.hasNextPage ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              className={styles.more}
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              Load more
            </Button>
          ) : null}
        </div>
      </SegmentedTabs>
    </section>
  );
}
