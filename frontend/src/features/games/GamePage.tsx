import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { SquarePenIcon } from "../../components/ui/icons";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { StatusLine } from "../../components/ui/StatusLine";
import { TeamIcon } from "../../components/ui/TeamIcon";
import { VisuallyHidden } from "../../components/ui/VisuallyHidden";
import { offersMemberLinks, useAccount } from "../../auth/account";
import { useComposeLinkState } from "../../routes/modal-flow";
import { fetchGame, gameKey, type GameDetailOut, type TeamRefOut } from "./api";
import { BoxScore } from "./BoxScore";
import { formatGameDate, teamShortName } from "./format";
import styles from "./Games.module.css";
import { LineScore } from "./LineScore";
import { MatchupArtwork } from "./MatchupArtwork";
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
 *
 * FRONTEND-037: each team in the heading links to its Stats > Seasons page,
 * for the `?season=` the game was opened with (none: the default season),
 * and the two box scores are team tabs, one shown at a time.
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

  // Keyed, so another game starts on its own default team tab.
  return <Game key={game.data.id} game={game.data} />;
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
  const hasLineScore =
    game.home_line_score !== null && game.away_line_score !== null;
  // A signed-in account that is not deactivated (`FRONTEND-012`): a
  // deactivated one browses as a guest, and a guest is offered none.
  const canPost = offersMemberLinks(useAccount());
  // FRONTEND-020: the composer opens over this page (or the flow's page).
  const composeState = useComposeLinkState();
  // 0-0 is a game not yet played: there is no result to post about.
  const completed = homeScore !== 0 || awayScore !== 0;
  const [searchParams] = useSearchParams();
  const season = searchParams.get("season");
  const sides = {
    away: { team: away, score: awayScore, boxScore: game.away_box_score },
    home: { team: home, score: homeScore, boxScore: game.home_box_score },
  };
  // The winner's tab first; a tie or an unplayed game puts the home team's.
  const order: Side[] =
    awayScore > homeScore ? ["away", "home"] : ["home", "away"];
  // A ?line= player line starts on its team, so the marked row is shown.
  const line = Number(searchParams.get("line") ?? Number.NaN);
  const [selected, setSelected] = useState<Side>(
    () =>
      order.find((side) =>
        sides[side].boxScore.players.some((player) => player.line_id === line),
      ) ?? order[0],
  );
  const shown = sides[selected];

  return (
    <article className={styles.page}>
      <header className={styles.header}>
        {label === "" ? null : <p className={styles.label}>{label}</p>}
        <h1 className={styles.heading}>
          <span className={styles.side}>
            <TeamIcon abbreviation={away.abbreviation} size="sm" />{" "}
            <Link to={seasonTeamHref(away, season)}>{away.name}</Link>{" "}
            <span className={styles.score}>{awayScore}</span>
          </span>{" "}
          <span className={styles.at}>at</span>{" "}
          <span className={styles.side}>
            <TeamIcon abbreviation={home.abbreviation} size="sm" />{" "}
            <Link to={seasonTeamHref(home, season)}>{home.name}</Link>{" "}
            <span className={styles.score}>{homeScore}</span>
          </span>
        </h1>
        {canPost && completed ? (
          <p className={styles.postGame}>
            <Link
              to={postAboutGameHref(game.id)}
              state={composeState}
              className={styles.postLink}
            >
              <SquarePenIcon size={16} />
              Post about this<VisuallyHidden> game</VisuallyHidden>
            </Link>
          </p>
        ) : null}
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

      <MatchupArtwork
        awayName={away.name}
        homeName={home.name}
        awayScore={awayScore}
        homeScore={homeScore}
        date={formatGameDate(game.date)}
      />

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

      <SegmentedTabs
        label="Team box scores"
        tabs={order.map((side) => ({
          id: side,
          label: `${teamShortName(sides[side].team.name)} ${sides[side].score}`,
        }))}
        value={selected}
        onChange={(id) => setSelected(id === "away" ? "away" : "home")}
      >
        <BoxScore
          key={selected}
          team={shown.team}
          boxScore={shown.boxScore}
          gameId={game.id}
          canPost={canPost}
        />
      </SegmentedTabs>
    </article>
  );
}

type Side = "away" | "home";

/**
 * A team's Stats > Seasons page, for the season the game was opened with, or
 * none (the Seasons tab's default). Built here, not imported from the stats
 * feature: features reach each other by address only.
 */
function seasonTeamHref(team: TeamRefOut, season: string | null): string {
  const params = new URLSearchParams();
  if (season !== null) params.set("season", season);
  params.set("team", String(team.id));
  return `/stats/seasons?${params.toString()}`;
}
