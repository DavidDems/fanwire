import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import { PreparedPostNode } from "../feed/PreparedPostNode";
import { SearchBar } from "./SearchBar";
import styles from "./Search.module.css";
import {
  accountsKey,
  fetchAccountsPage,
  fetchPostsPage,
  postsKey,
} from "./api";

/**
 * `/search` — the free-text bar and its two result sections (`layout.md` §3).
 *
 * **Accounts and posts only.** Sports data (seasons, teams, games, players)
 * lives on the Stats page since `FRONTEND-009`, which took the old dropdown
 * game filter's place; this page searches people and what they wrote.
 *
 * **Two queries, two paginations.** Accounts and posts are independent requests
 * with their own `next_offset` ("accounts first" is a rendering order, not a
 * combined cursor), so each section is its own infinite query with its own Load
 * more, and paging one never refetches the other.
 */
export function SearchPage() {
  const [params] = useSearchParams();
  // Trimmed the way the bar trims it, so a hand-typed `?q=%20` asks nothing.
  const q = (params.get("q") ?? "").trim();

  return (
    <section className={styles.page}>
      <h1>Search</h1>
      <SearchBar />
      {q === "" ? null : (
        <>
          <AccountResults q={q} />
          <PostResults q={q} />
        </>
      )}
    </section>
  );
}

/** "Accounts": one list card with dividers, as the notifications list is. */
function AccountResults({ q }: { q: string }) {
  const accounts = useInfiniteQuery({
    queryKey: accountsKey(q),
    queryFn: ({ pageParam }) => fetchAccountsPage(q, pageParam),
    initialPageParam: 0,
    // `next_offset` straight through: `null` is react-query's own "no further page".
    getNextPageParam: (lastPage) => lastPage.next_offset,
  });
  const items = (accounts.data?.pages ?? []).flatMap((page) => page.items);

  return (
    <section className={styles.section} aria-labelledby="search-accounts">
      <h2 id="search-accounts">Accounts</h2>

      {accounts.isPending ? <StatusLine>Searching accounts…</StatusLine> : null}
      {accounts.isError ? (
        <InlineAlert>
          We could not search accounts just now. Please try again.
        </InlineAlert>
      ) : null}
      {accounts.isSuccess && items.length === 0 ? (
        <EmptyState>No accounts match “{q}”.</EmptyState>
      ) : null}

      {items.length === 0 ? null : (
        <Card>
          <ul className={styles.list}>
            {items.map((account) => (
              <li key={account.id} className={styles.row}>
                <Avatar
                  username={account.username}
                  size="sm"
                  avatarKey={account.profile_avatar_key}
                  pictureKey={account.profile_picture_key}
                />
                <div className={styles.body}>
                  <Link
                    to={`/profile/${account.id}`}
                    className={styles.username}
                  >
                    {account.username}
                  </Link>
                  {account.description === null ? null : (
                    <p className={styles.muted}>{account.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!accounts.hasNextPage ? null : (
        <Button
          type="button"
          variant="secondary"
          size="md"
          className={styles.more}
          onClick={() => void accounts.fetchNextPage()}
          disabled={accounts.isFetchingNextPage}
        >
          Load more accounts
        </Button>
      )}
    </section>
  );
}

/**
 * "Posts": a stack of the feed's own `PostNode` cards, so a result is the same
 * post — likes, replies and all — as it is on the feed, not a look-alike.
 * Each is prepared before it is shown, by the feed's `PreparedPostNode`
 * (`FRONTEND-015`).
 */
function PostResults({ q }: { q: string }) {
  const posts = useInfiniteQuery({
    queryKey: postsKey(q),
    queryFn: ({ pageParam }) => fetchPostsPage(q, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.next_offset,
  });
  const items = (posts.data?.pages ?? []).flatMap((page) => page.items);

  return (
    <section className={styles.section} aria-labelledby="search-posts">
      <h2 id="search-posts">Posts</h2>

      {posts.isPending ? <StatusLine>Searching posts…</StatusLine> : null}
      {posts.isError ? (
        <InlineAlert>
          We could not search posts just now. Please try again.
        </InlineAlert>
      ) : null}
      {posts.isSuccess && items.length === 0 ? (
        <EmptyState>No posts match “{q}”.</EmptyState>
      ) : null}

      {items.length === 0 ? null : (
        <ol className={styles.stream}>
          {items.map((post) => (
            <li key={post.id}>
              <PreparedPostNode post={post} />
            </li>
          ))}
        </ol>
      )}

      {!posts.hasNextPage ? null : (
        <Button
          type="button"
          variant="secondary"
          size="md"
          className={styles.more}
          onClick={() => void posts.fetchNextPage()}
          disabled={posts.isFetchingNextPage}
        >
          Load more posts
        </Button>
      )}
    </section>
  );
}
