import { useInfiniteQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PreparedPostNode } from "../feed/PreparedPostNode";
import { ResultSection } from "./ResultSection";
import { SearchBar } from "./SearchBar";
import styles from "./Search.module.css";
import { accountsQuery, postsQuery } from "./api";

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

/**
 * "Accounts": one list card with dividers, as the notifications list is.
 *
 * The home page's rail (`FRONTEND-036`) shows the same section as a preview,
 * by passing `showAll`: an h3 under its own h2, the first five of the first
 * page only, Retry beside a failure, and its Show all link in place of Load
 * more.
 */
export function AccountResults({
  q,
  showAll,
}: {
  q: string;
  showAll?: ReactNode;
}) {
  const accounts = useInfiniteQuery(accountsQuery(q));
  const pages = accounts.data?.pages ?? [];
  const items = showAll
    ? (pages[0]?.items.slice(0, 5) ?? [])
    : pages.flatMap((page) => page.items);

  return (
    <ResultSection
      title="Accounts"
      level={showAll ? 3 : 2}
      q={q}
      query={accounts}
      count={items.length}
      retry={Boolean(showAll)}
      footer={
        showAll ??
        (!accounts.hasNextPage ? null : (
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
        ))
      }
    >
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
                <Link to={`/profile/${account.id}`} className={styles.username}>
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
    </ResultSection>
  );
}

/**
 * "Posts": a stack of the feed's own `PostNode` cards, so a result is the same
 * post — likes, replies and all — as it is on the feed, not a look-alike.
 * Each is prepared before it is shown, by the feed's `PreparedPostNode`
 * (`FRONTEND-015`).
 */
function PostResults({ q }: { q: string }) {
  const posts = useInfiniteQuery(postsQuery(q));
  const items = (posts.data?.pages ?? []).flatMap((page) => page.items);

  return (
    <ResultSection
      title="Posts"
      level={2}
      q={q}
      query={posts}
      count={items.length}
      footer={
        !posts.hasNextPage ? null : (
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
        )
      }
    >
      <ol className={styles.stream}>
        {items.map((post) => (
          <li key={post.id}>
            <PreparedPostNode post={post} />
          </li>
        ))}
      </ol>
    </ResultSection>
  );
}
