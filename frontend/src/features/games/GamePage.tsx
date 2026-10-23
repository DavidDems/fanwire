import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { SquarePenIcon } from "../../components/ui/icons";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import { VisuallyHidden } from "../../components/ui/VisuallyHidden";
import { useAuth } from "../../auth/AuthContext";
import { fetchGame, gameKey, type GameDetailOut } from "./api";
import { BoxScore } from "./BoxScore";
import { formatGameDate } from "./format";
import styles from "./Games.module.css";
import { LineScore } from "./LineScore";
import { postAboutGameHref } from "./postLinks";

/**
 * `/games/:gameId`: one game from `GET /events/games/{id}` — the two teams
 * and the final score, the line score, and each team's box score.
 *
 * Public, and reached by address only: other features link to `/games/<id>`
 * and never import this folder ([[0x00-architecture]] Connection rule). An id
 * the backend does not know is a not-found page, not an error, because a
 * shared or mistyped link lands there in the normal course of things.
 *
 * A signed-in viewer also gets "Post about this" links (`FRONTEND-017`): one
 * for a completed game's result, by the score header, and one per played
 * box-score row. Each goes to the composer's pre-filled address
 * (`postLinks.ts`); a guest sees none, since compose would send them through
 * sign-in first.
 */
export function GamePage() {
  const { gameId: raw } = useParams();
  const gameId = Number(raw);
  const valid = Number.isSafeInteger(gameId) && gameId > 0;

  const game = useQuery({
    queryKey: gameKey(gameId),
    queryFn: () => fetchGame(gameId),
    enabled: valid,
  });

  if (!valid || game.data === null) return <GameNotFound />;

  if (game.isError) {
    return (
      <section className={styles.page}>
        <InlineAlert>
          We could not load this game just now. Please try again.
        </InlineAlert>
      </section>
    );
  }

  if (game.data === undefined) {
    return (
      <section className={styles.page}>
        <StatusLine>Loading the game…</StatusLine>
      </section>
    );
  }

  return <Game game={game.data} />;
}

function GameNotFound() {
  return (
    <section className={styles.page}>
      <h1>Game not found</h1>
      <p>
        We could not find that game. The link may be mistyped or out of date.
      </p>
      <p>
        <Link to="/">Back to the feed</Link>
      </p>
    </section>
  );
}

function Game({ game }: { game: GameDetailOut }) {
  const {
    away_team: away,
    home_team: home,
    away_score: awayScore,
    home_score: homeScore,
  } = game;
  const label = [game.label, game.sub_label]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");
  const winner =
    homeScore > awayScore ? home : awayScore > homeScore ? away : null;
  const hasLineScore =
    game.home_line_score !== null && game.away_line_score !== null;
  const canPost = useAuth().status === "authenticated";
  // 0-0 is a game not yet played: there is no result to post about.
  const completed = homeScore !== 0 || awayScore !== 0;

  return (
    <article className={styles.page}>
      <header className={styles.header}>
        {label === "" ? null : <p className={styles.label}>{label}</p>}
        <h1 className={styles.heading}>
          <span className={styles.side}>
            <span>{away.name}</span>{" "}
            <span className={styles.score}>{awayScore}</span>
          </span>{" "}
          <span className={styles.at}>at</span>{" "}
          <span className={styles.side}>
            <span>{home.name}</span>{" "}
            <span className={styles.score}>{homeScore}</span>
          </span>
        </h1>
        {canPost && completed ? (
          <p className={styles.postGame}>
            <Link to={postAboutGameHref(game.id)} className={styles.postLink}>
              <SquarePenIcon size={16} />
              Post about this<VisuallyHidden> game</VisuallyHidden>
            </Link>
          </p>
        ) : null}
        {winner === null ? null : (
          <p className={styles.result}>
            Final: {winner.name} won, {Math.max(homeScore, awayScore)}–
            {Math.min(homeScore, awayScore)}
          </p>
        )}
        <p className={styles.muted}>
          <time dateTime={game.date}>{formatGameDate(game.date)}</time>
          {game.venue === null || game.venue === "" ? null : (
            <>
              {" · "}
              <span>{game.venue}</span>
            </>
          )}
        </p>
      </header>

      {!hasLineScore ? null : (
        <LineScore
          awayTeam={away}
          homeTeam={home}
          awayLineScore={game.away_line_score ?? []}
          homeLineScore={game.home_line_score ?? []}
          awayScore={awayScore}
          homeScore={homeScore}
        />
      )}

      <BoxScore
        team={away}
        boxScore={game.away_box_score}
        gameId={game.id}
        canPost={canPost}
      />
      <BoxScore
        team={home}
        boxScore={game.home_box_score}
        gameId={game.id}
        canPost={canPost}
      />
    </article>
  );
}
