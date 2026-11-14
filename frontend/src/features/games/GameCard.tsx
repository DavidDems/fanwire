import { Link } from "react-router-dom";

import { TeamIcon } from "../../components/ui/TeamIcon";
import { useDetailLinkState } from "../../routes/modal-flow";
import type { components } from "../../api/schema";
import { teamShortName } from "./format";
import styles from "./GameCard.module.css";

type TeamRefOut = components["schemas"]["TeamRefOut"];

/** One team's line of a card. */
export interface GameCardSide {
  /** `null` while not decided (an NBA Cup knockout game): it reads "TBD". */
  team: TeamRefOut | null;
  /** The team's overall record, where the read has one. */
  record?: { wins: number; losses: number };
  /** A played game's score; absent for a game not played yet. */
  score?: number;
}

export interface GameCardProps {
  away: GameCardSide;
  home: GameCardSide;
  /**
   * The game's address (`/games/<id>…`): the card is then one link, opened in
   * the detail modal over the page. Without it the card is not a link.
   */
  to?: string;
  /** A line under the teams: a game not played yet's start, "7:30 PM ET". */
  time?: string;
}

/**
 * The compact game card (FRONTEND-037, shared since FRONTEND-044 by Recent
 * Games and the Schedule page): away above home, each side its icon, short
 * name, and, where given, record and score. When both scores are given the
 * loser's side is muted and the winner's named in hidden text, so the result
 * is never colour alone.
 */
export function GameCard({ away, home, to, time }: GameCardProps) {
  const state = useDetailLinkState();
  const content = (
    <>
      <Side side={away} other={home.score} />
      <Side side={home} other={away.score} />
      {time === undefined ? null : <span className={styles.time}>{time}</span>}
    </>
  );
  return to === undefined ? (
    <div className={styles.card}>{content}</div>
  ) : (
    <Link className={styles.card} to={to} state={state}>
      {content}
    </Link>
  );
}

/** One team's line: icon, short name, (wins-losses), score. */
function Side({ side, other }: { side: GameCardSide; other?: number }) {
  const { team, record, score } = side;
  const result =
    score === undefined || other === undefined
      ? undefined
      : score > other
        ? styles.winner
        : score < other
          ? styles.loser
          : undefined;
  return (
    <span
      className={
        result === undefined ? styles.side : `${styles.side} ${result}`
      }
    >
      <TeamIcon abbreviation={team?.abbreviation} size="sm" />{" "}
      <span className={styles.name}>
        {team === null ? "TBD" : teamShortName(team.name)}
        {record === undefined ? null : (
          <>
            {" "}
            <span className={styles.record}>
              ({record.wins}-{record.losses})
            </span>
          </>
        )}
      </span>{" "}
      {/* The space stays without a score, so the next side's text is apart. */}
      {score === undefined ? null : (
        <span className={styles.score}>
          {score}
          {/*
            base.css's hidden-text class directly, not the VisuallyHidden
            wrapper: importing it here folds its shared chunk into another.
          */}
          {other !== undefined && score > other ? (
            <span className="visually-hidden">, winner</span>
          ) : null}
        </span>
      )}
    </span>
  );
}
