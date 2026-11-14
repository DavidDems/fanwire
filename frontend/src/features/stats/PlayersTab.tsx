import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Field, describeField } from "../../components/FormField";
import { PlayerResults } from "../../components/stats-nav/PlayerResults";
import { Card } from "../../components/ui/Card";
import { ROUTE_LINKS } from "./links";
import styles from "./Stats.module.css";

const BOX_ID = "stats-player-search";
/** How long the box waits after the last keystroke before it searches. */
const SEARCH_DEBOUNCE_MS = 250;
/** A cap on the text, as the Search page has, so an address stays short. */
const MAX_QUERY_LENGTH = 100;

/**
 * `/stats/players`: a small player search. As the user types, the trimmed
 * text goes into the address as `?q=` after a short pause, and the address is
 * what is searched, so a reload or a shared link searches again. An empty box
 * searches nothing.
 *
 * The results are the stats navigator's player-results view.
 */
export function PlayersTab() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const [text, setText] = useState(q);

  // Back, forward or a link changes `?q=` under the box: show what is being
  // searched for. Adjusted during render; the box's own pending text is kept
  // when it already says the same thing.
  const [shownFor, setShownFor] = useState(q);
  if (shownFor !== q) {
    setShownFor(q);
    if (text.trim() !== q) setText(q);
  }

  useEffect(() => {
    const wanted = text.trim();
    if (wanted === q) return;
    const timer = setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (wanted === "") next.delete("q");
          else next.set("q", wanted);
          return next;
        },
        // Each pause is not a page in the history.
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, q, setParams]);

  return (
    <div className={styles.tab}>
      <Card>
        <div role="search" className={styles.controls}>
          <Field id={BOX_ID} label="Search players">
            <input
              {...describeField(BOX_ID)}
              type="search"
              autoComplete="off"
              maxLength={MAX_QUERY_LENGTH}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
        </div>
      </Card>
      {q === "" ? null : <PlayerResults q={q} adapter={ROUTE_LINKS} />}
    </div>
  );
}
