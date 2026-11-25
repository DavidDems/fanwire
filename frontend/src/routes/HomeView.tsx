import { lazy, Suspense } from "react";

import { Skeleton } from "../components/ui/Skeleton";
import { FeedPage } from "../features/feed/FeedPage";
import { BOX_ID } from "../features/search/SearchBar";
import { SearchRail } from "../features/search/SearchRail";
import shellStyles from "./AppLayout.module.css";
import styles from "./HomeView.module.css";
import { useDetailLinkState } from "./modal-flow";
import { useMediaQuery } from "./useMediaQuery";

/** Where the home page gains its right rail: 76.0625em (1217 px). */
const RecentGames = lazy(() =>
  import("../features/games/RecentGames").then((module) => ({
    default: module.RecentGames,
  })),
);

const RAIL_FROM = "(min-width: 76.0625em)";

/**
 * `/` — the feed, and from 76.0625em a right rail beside it (`FRONTEND-036`).
 *
 * There is no search bar above the feed at any width. The rail holds the
 * search bar and, on `/?q=`, a preview of its results, then recent games (`EVENTS-013`). Below 76.0625em the rail is **not mounted**,
 * not hidden, so a phone makes none of its requests; search there is the
 * Search link (`FRONTEND-035`) to `/search`. The rail follows the feed, so
 * mounting or unmounting it never remounts `FeedPage`, which keeps its pages
 * and place when `q` changes.
 *
 * While the rail is mounted, a "Skip to search" link comes first in `main`,
 * before the feed (`FRONTEND-056`): at 1280 px the rail's box was about 150
 * Tabs after the feed's top. It has the shell's skip-link look (its
 * `skipLink` class: hidden until focused) and, like Skip to content, focuses
 * its target on activation, since a hash link does not move focus everywhere.
 * It sits before the `.home` container, not in it, so the feed stays
 * `.home`'s first child; the rail itself stays after the feed.
 *
 * Composed here rather than inside a feature: the feed, search and the
 * games are separate features, and none imports another
 * ([[0x00-architecture]] Connection rule). The feed's `h1` stays the page's
 * only one.
 */
export function HomeView() {
  const withRail = useMediaQuery(RAIL_FROM);
  const postLinkState = useDetailLinkState();
  return (
    <>
      {!withRail ? null : (
        <a
          href={`#${BOX_ID}`}
          className={shellStyles.skipLink}
          onClick={() => document.getElementById(BOX_ID)?.focus()}
        >
          Skip to search
        </a>
      )}
      <div className={styles.home}>
        <FeedPage />
        {!withRail ? null : (
          <aside className={styles.rail}>
            <SearchRail postLinkState={postLinkState} />
            <Suspense fallback={<RecentGamesLoading />}>
              <RecentGames />
            </Suspense>
          </aside>
        )}
      </div>
    </>
  );
}

/** Reserve the same five rows while the feature chunk itself loads. */
function RecentGamesLoading() {
  return (
    <section style={{ marginTop: "var(--space-5)", minWidth: 0 }}>
      <h2 style={{ marginBottom: "var(--space-3)" }}>Recent games</h2>
      <div role="status" aria-label="Loading recent games">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            style={{
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              minHeight:
                "calc(2 * var(--space-6) + var(--space-1) + 2 * var(--space-2))",
              padding: "var(--space-2)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <Skeleton variant="line" />
          </div>
        ))}
      </div>
    </section>
  );
}
