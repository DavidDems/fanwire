import type { ReactNode } from "react";

import { GameScore } from "../../components/ui/GameScore";
import styles from "./LiveScoreTickerDecorator.module.css";
import type { PostView } from "./api";

/**
 * The live-score ticker, as a Decorator over a rendered post
 * ([[wiki/CodeContext/Standards/gof-patterns|GoF patterns]] "Decorator").
 *
 * **It renders what it wraps.** A component that took the post and drew only the
 * scores would be a replacement wearing the name of a decorator, and it would
 * satisfy every test that looked for the score. So the children come first and
 * the ticker is added beside them; the wrapped view neither knows nor changes.
 * That holds for styling too: the band below is the ticker's own element, and
 * the children are returned bare in the fragment, never inside a styled
 * container. A wrapper that set the post's spacing or background would be the
 * decorator restyling what it decorates.
 *
 * **Who decides to wrap is `PostNode`, not this module.** A post whose
 * `live_scores` is empty is rendered unwrapped and this component is not in the
 * tree at all — an always-mounted decorator that returned `null` for the empty
 * case would be a conditional badge with extra steps, and the criterion is about
 * the tree.
 *
 * `live_scores` is only ever filled for a mentioned game inside the backend's
 * four-hour window ([[0x06-feed]] View assembly); nothing here re-decides that,
 * and there is no polling. What the page was handed is what it shows.
 *
 * Each game is a `GameScore`, which owns the status mapping (a Live badge only
 * for a code it knows is in play) and the Home / Away words. `LiveScoreView`
 * carries no team names, so none are shown and none are fetched: naming the
 * teams is a backend follow-up (`components.md` §4).
 */

export interface LiveScoreTickerDecoratorProps {
  post: PostView;
  /** The post view being decorated — rendered as given. */
  children: ReactNode;
}

export function LiveScoreTickerDecorator({
  post,
  children,
}: LiveScoreTickerDecoratorProps) {
  return (
    <>
      {children}
      {/*
       * `role="status"` is the honest role for a score that changes under the
       * reader without them asking, and it is announced politely rather than
       * interrupting. The label is what names it: a bare live region with only
       * numbers in it tells a screen-reader user nothing about what moved.
       */}
      <div role="status" aria-label="Live score" className={styles.ticker}>
        <ul className={styles.games}>
          {/*
           * One block per game, because a post can mention several and a single
           * merged line would read as one score with four numbers in it. The
           * status is GameScore's to show, once; it is not repeated here.
           */}
          {post.live_scores.map((score) => (
            <li key={score.game_id} className={styles.game}>
              <span className={styles.label}>{`Game ${score.game_id}`}</span>
              <GameScore
                variant="compact"
                homeScore={score.home_score}
                awayScore={score.away_score}
                status={score.status}
              />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
