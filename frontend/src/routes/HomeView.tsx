import { FeedPage } from "../features/feed/FeedPage";
import { SearchBar } from "../features/search/SearchBar";
import styles from "./HomeView.module.css";

/**
 * `/` — the free-text search bar above the feed.
 *
 * Composed here rather than inside `FeedPage`: the bar is `FRONTEND-007`'s and
 * the feed is `FRONTEND-005`'s, and neither feature imports the other
 * ([[0x00-architecture]] Connection rule). The bar navigates to
 * `/search?q=…`, so the home page and the search route reach the same results
 * view ([[0x07-search]]). The feed's `h1` stays the page's only one.
 */
export function HomeView() {
  return (
    <div className={styles.home}>
      <SearchBar />
      <FeedPage />
    </div>
  );
}
