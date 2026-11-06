import { FeedPage } from "../features/feed/FeedPage";
import { SearchRail } from "../features/search/SearchRail";
import styles from "./HomeView.module.css";
import { useDetailLinkState } from "./modal-flow";
import { useMediaQuery } from "./useMediaQuery";

/** Where the home page gains its right rail: 76.0625em (1217 px). */
const RAIL_FROM = "(min-width: 76.0625em)";

/**
 * `/` — the feed, and from 76.0625em a right rail beside it (`FRONTEND-036`).
 *
 * There is no search bar above the feed at any width. The rail holds the
 * search bar and, on `/?q=`, a preview of its results, then a slot that
 * `EVENTS-013`'s recent games fill. Below 76.0625em the rail is **not mounted**,
 * not hidden, so a phone makes none of its requests; search there is the
 * Search link (`FRONTEND-035`) to `/search`. The rail follows the feed, so
 * mounting or unmounting it never remounts `FeedPage`, which keeps its pages
 * and place when `q` changes.
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
    <div className={styles.home}>
      <FeedPage />
      {!withRail ? null : (
        <aside className={styles.rail}>
          <SearchRail postLinkState={postLinkState} />
          {/* EVENTS-013: recent games go here; nothing yet. */}
        </aside>
      )}
    </div>
  );
}
