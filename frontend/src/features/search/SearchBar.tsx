import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { SearchInput } from "../../components/ui/SearchInput";
import styles from "./Search.module.css";

/** The backend's own cap on `q` ([[0x07-search]] Routes). */
const MAX_QUERY_LENGTH = 100;

const BOX_ID = "search-bar-q";

/**
 * The free-text bar over accounts and posts — one component, on the home page
 * and on `/search`.
 *
 * **The address is the seam.** Submitting goes to `/search?q=<text>` and
 * `SearchPage` reads `q` from there, so both entry points reach the same results
 * view by construction, and a result is a link someone can share or reload.
 *
 * It searches accounts and posts only. Sports data (seasons, teams, games and
 * players) is the Stats page's, since `FRONTEND-009`, and shares nothing with
 * this.
 */
export function SearchBar() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  // Keyed by the address's `q`, so the box shows what is being searched for
  // after back and forward too, not whatever was last typed into it.
  return <SearchForm key={q} initial={q} />;
}

function SearchForm({ initial }: { initial: string }) {
  const navigate = useNavigate();
  const [text, setText] = useState(initial);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const q = text.trim();
    // The route answers 422 for an empty `q`, so an empty search is not a
    // request worth sending — or an address worth going to.
    if (q === "") return;
    navigate(`/search?${new URLSearchParams({ q }).toString()}`);
  }

  return (
    <Card>
      <form role="search" className={styles.bar} onSubmit={handleSubmit}>
        <SearchInput
          id={BOX_ID}
          label="Search accounts and posts"
          name="q"
          maxLength={MAX_QUERY_LENGTH}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <Button type="submit" variant="primary" size="md">
          Search
        </Button>
      </form>
    </Card>
  );
}
