import { useInfiniteQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "../../components/ui/Button";
import { ResultSection } from "./ResultSection";
import { BOX_ID, SearchBar } from "./SearchBar";
import { AccountResults } from "./SearchPage";
import styles from "./SearchRail.module.css";
import { accountsQuery, postsQuery } from "./api";

export interface SearchRailProps {
  /**
   * The history state a post row's time link carries, so the thread opens
   * over the home page (the modal flow, `routes/modal-flow.tsx`). Handed in by
   * the route that composes the rail, which keeps this feature's imports to
   * `PostNode`, `feed/api` and `components/ui`.
   */
  postLinkState: unknown;
}

/**
 * The search half of the home page's right rail (`FRONTEND-036`): the shared
 * `SearchBar`, and, when the address has `?q=`, a preview of the results
 * beside the feed.
 *
 * **`/?q=` is the rail's address**, so a search here can be shared, reloaded
 * and undone with Back, and the feed beside it is never reloaded. **A
 * preview, not a second results page**: at most five accounts and five posts
 * from the first page of the very infinite queries `/search` pages through,
 * each section ending with Show all to `/search?q=`, which then opens from the
 * cache. A post row is compact (author, time, three lines of text) because a
 * full card does not fit the rail, and it has no controls.
 *
 * The count is announced once per search, when both sections have settled,
 * in a polite live region that is in the rail before any search.
 */
export function SearchRail({ postLinkState }: SearchRailProps) {
  const [params] = useSearchParams();
  // Trimmed the way the bar trims it, so a hand-typed `?q=%20` asks nothing.
  const q = (params.get("q") ?? "").trim();
  const enabled = q !== "";
  const accounts = useInfiniteQuery({ ...accountsQuery(q), enabled });
  const posts = useInfiniteQuery({ ...postsQuery(q), enabled });
  const navigate = useNavigate();
  const cleared = useRef(false);

  // Clear search remounts the bar (it is keyed to `q`): focus the new box.
  useEffect(() => {
    if (enabled || !cleared.current) return;
    cleared.current = false;
    document.getElementById(BOX_ID)?.focus();
  }, [enabled]);

  // The first page only, five at most, as the sections show: `/search` has
  // the rest. The accounts are `AccountResults`'s, read here for the count.
  const accountItems = accounts.data?.pages[0].items.slice(0, 5) ?? [];
  const postItems = posts.data?.pages[0].items.slice(0, 5) ?? [];
  const showAll = (noun: string) => (
    <Link
      to={`/search?${new URLSearchParams({ q })}`}
      aria-label={`Show all ${noun}`}
    >
      Show all
    </Link>
  );

  // A post's time is the feed's own format: the same text for every reader,
  // never relative. `created_at` is the server's own ISO timestamp.
  return (
    <div className={styles.rail}>
      <SearchBar />
      <p className="visually-hidden" aria-live="polite">
        {enabled && !accounts.isPending && !posts.isPending
          ? `Results for “${q}”: ${accountItems.length + postItems.length} shown.`
          : ""}
      </p>
      {!enabled ? null : (
        <section aria-labelledby="rail-results">
          <div className={styles.head}>
            <h2 id="rail-results">Results for “{q}”</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                // `q` is the home page's only parameter.
                cleared.current = true;
                navigate("/");
              }}
            >
              Clear search
            </Button>
          </div>
          <AccountResults q={q} showAll={showAll("accounts")} />
          <ResultSection
            title="Posts"
            level={3}
            q={q}
            query={posts}
            count={postItems.length}
            retry
            footer={showAll("posts")}
          >
            <ul>
              {postItems.map((post) => (
                <li key={post.id}>
                  <Link to={`/profile/${post.author.id}`}>
                    {post.author.username}
                  </Link>{" "}
                  <Link to={`/posts/${post.id}`} state={postLinkState}>
                    <time dateTime={post.created_at}>
                      {format(parseISO(post.created_at), "d MMM yyyy, HH:mm")}
                    </time>
                  </Link>
                  {post.text ? <p>{post.text}</p> : null}
                </li>
              ))}
            </ul>
          </ResultSection>
        </section>
      )}
    </div>
  );
}
