/**
 * FRONTEND-017 criteria 1, 2, 4 and 5 (the game page's half): "Post about
 * this" on the game page and on each played box-score row.
 *
 * Every test renders the whole app through the real route table
 * (`renderAppAt`), so the signed-in rule is `useAuth()` as the shell sees it,
 * and the end-to-end tests follow the link into the real `/compose` route and
 * `FRONTEND-013`'s parser. Nothing here imports the page or the composer.
 *
 * The interface this file pins:
 *
 * - **The game result.** On a completed game (not both scores 0) a signed-in
 *   viewer sees exactly one link to `/compose?link=game_final&ref=<game id>`,
 *   named /post about/i, outside the box-score tables (it sits by the score
 *   header). On a 0–0 game there is none.
 * - **Each played row.** Every box-score row whose `seconds_played` is not
 *   null has exactly one /post about/i link, whose accessible name includes
 *   the player's full name, to
 *   `/compose?link=player_game&ref=<line_id>&game=<game id>`. A played-shaped
 *   row stored as a DNP (`seconds_played` null), the did-not-play lists and
 *   the totals row have none. Where in the row the link sits (the name cell
 *   or a trailing cell) is the implementation's.
 * - **Signed out**, none of these links exists.
 * - **Deactivated** (`FRONTEND-012`): a signed-in account its owner
 *   deactivated browses as a guest, so none exists for it either.
 * - Addresses are compared as a path and a set of parameters
 *   (`src/test/post-about.ts`): exact, but not order-sensitive.
 *
 * The fixture is the composer's game 501 (`src/test/attach.ts`): every played
 * row has its own `line_id`, and Toronto's box score carries one played-shaped
 * DNP row ("Ghost Rowman", line 80099).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { deactivatedShown } from "../../test/account";
import { renderAppAt, type Visitor } from "../../test/app-route";
import {
  BARNES_LINE_ID,
  attachGameDetail,
  attachServer,
  summaryShown,
  textOf,
  unplayedGameDetail,
} from "../../test/attach";
import {
  composeLinks,
  composeTarget,
  gameFinalAddress,
  linksTo,
  playerGameAddress,
  postAboutLinks,
  signedInShown,
  signedOutShown,
} from "../../test/post-about";
import type {
  BoxScorePlayerOut,
  DidNotPlayOut,
  GameDetailOut,
  TeamRefOut,
} from "../../test/games";

const GAME = attachGameDetail();
const UNPLAYED = unplayedGameDetail();

function fullName(player: BoxScorePlayerOut | DidNotPlayOut): string {
  return [player.first_name, player.last_name]
    .filter((part): part is string => part !== null && part !== "")
    .join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The schema types it as a number; a stored DNP row has null. */
function played(player: BoxScorePlayerOut): boolean {
  const seconds = player.seconds_played as number | null;
  return seconds !== null;
}

function main(): HTMLElement {
  return screen.getByRole("main");
}

async function openGame(game: GameDetailOut, as: Visitor) {
  const { handlers } = attachServer();
  const rendered = renderAppAt(`/games/${game.id}`, as, handlers);
  await screen.findByRole("heading", {
    level: 1,
    name: new RegExp(escapeRegExp(game.home_team.name)),
  });
  if (as === "anonymous") await signedOutShown();
  else if (as === "deactivated") await deactivatedShown();
  else await signedInShown();
  return { router: rendered.router, user: userEvent.setup() };
}

function boxScoreFor(team: TeamRefOut): HTMLTableElement {
  const table = screen
    .getAllByRole("table")
    .find((candidate) =>
      new RegExp(`${escapeRegExp(team.name)}.*box score`, "i").test(
        candidate.querySelector("caption")?.textContent ?? "",
      ),
    );
  if (table === undefined) throw new Error(`no box score for ${team.name}`);
  return table as HTMLTableElement;
}

/** The body row whose row header holds `player`'s name link. */
function rowFor(
  table: HTMLTableElement,
  player: BoxScorePlayerOut,
): HTMLTableRowElement {
  const name = within(table).getByRole("link", {
    name: new RegExp(`^${escapeRegExp(fullName(player))}$`),
  });
  const row = name.closest("tr");
  if (row === null) throw new Error(`${fullName(player)} has no row`);
  return row;
}

const SIDES = [
  [GAME.home_team.name, GAME.home_team, GAME.home_box_score],
  [GAME.away_team.name, GAME.away_team, GAME.away_box_score],
] as const;

const PLAYED_COUNT = [
  ...GAME.home_box_score.players,
  ...GAME.away_box_score.players,
].filter(played).length;

describe("the fixture this file relies on", () => {
  it("has played rows on both sides and a played-shaped DNP row", () => {
    expect(GAME.home_score === 0 && GAME.away_score === 0).toBe(false);
    expect(UNPLAYED.home_score).toBe(0);
    expect(UNPLAYED.away_score).toBe(0);
    expect(GAME.home_box_score.players.filter(played).length).toBeGreaterThan(
      0,
    );
    expect(GAME.away_box_score.players.filter(played).length).toBeGreaterThan(
      0,
    );
    expect(
      GAME.home_box_score.players.filter((player) => !played(player)),
    ).toHaveLength(1);
  });
});

describe("the game result: one 'Post about this' link, signed in", () => {
  it("a completed game links to /compose?link=game_final&ref=<game id>", async () => {
    await openGame(GAME, "member");

    const links = linksTo(main(), gameFinalAddress(GAME.id));
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(/post about/i);
    expect(
      links[0].closest("table"),
      "the game's link sits by the score header, not in a box score",
    ).toBeNull();
  });

  it("is the only game-result link on the page", async () => {
    await openGame(GAME, "member");

    const gameLinks = composeLinks(main()).filter((link) =>
      composeTarget(link.getAttribute("href")).params.some(
        ([key, value]) => key === "link" && value === "game_final",
      ),
    );
    expect(gameLinks).toHaveLength(1);
  });

  it("a 0-0 game has no game-result link", async () => {
    await openGame(UNPLAYED, "member");

    expect(linksTo(main(), gameFinalAddress(UNPLAYED.id))).toEqual([]);
    expect(composeLinks(main())).toEqual([]);
  });
});

describe("each played box-score row: a 'Post about …' link, signed in", () => {
  it.each(SIDES)(
    "%s: each played row links to its line, named for the player; a DNP row has none",
    async (_name, team, boxScore) => {
      await openGame(GAME, "member");
      const table = boxScoreFor(team);

      for (const player of boxScore.players) {
        const row = rowFor(table, player);
        if (!played(player)) {
          expect(postAboutLinks(row), fullName(player)).toEqual([]);
          expect(composeLinks(row), fullName(player)).toEqual([]);
          continue;
        }

        const links = postAboutLinks(row);
        expect(links, fullName(player)).toHaveLength(1);
        expect(links[0]).toHaveAccessibleName(
          new RegExp(escapeRegExp(fullName(player))),
        );
        expect(composeTarget(links[0].getAttribute("href"))).toEqual(
          playerGameAddress(player.line_id, GAME.id),
        );
        expect(composeLinks(row), fullName(player)).toHaveLength(1);
      }
    },
  );

  it.each(SIDES)(
    "%s: the did-not-play list and the totals row have none",
    async (_name, team, boxScore) => {
      await openGame(GAME, "member");

      expect(boxScore.did_not_play.length).toBeGreaterThan(0);
      const dnp = screen.getByRole("list", {
        name: new RegExp(`${escapeRegExp(team.name)}.*did not play`, "i"),
      });
      expect(composeLinks(dnp)).toEqual([]);

      const foot = boxScoreFor(team).tFoot;
      expect(foot).not.toBeNull();
      expect(composeLinks(foot as HTMLElement)).toEqual([]);
    },
  );

  it("offers one line link per played row and one game link, and nothing else", async () => {
    await openGame(GAME, "member");

    expect(PLAYED_COUNT).toBe(7);
    expect(composeLinks(main())).toHaveLength(PLAYED_COUNT + 1);
    expect(postAboutLinks(main())).toHaveLength(PLAYED_COUNT + 1);
  });
});

describe("signed out, the game page offers none of these links", () => {
  it("a completed game with a full box score shows no link to compose", async () => {
    await openGame(GAME, "anonymous");

    expect(composeLinks(main())).toEqual([]);
    expect(postAboutLinks(main())).toEqual([]);
    // The page is otherwise there: the box score's name links still are.
    expect(
      within(boxScoreFor(GAME.home_team)).getAllByRole("link").length,
    ).toBeGreaterThan(0);
  });
});

describe("a deactivated account, the game page offers none of these links (FRONTEND-012)", () => {
  it("a completed game with a full box score shows no link to compose, as for a guest", async () => {
    await openGame(GAME, "deactivated");

    expect(composeLinks(main())).toEqual([]);
    expect(postAboutLinks(main())).toEqual([]);
    expect(
      within(boxScoreFor(GAME.home_team)).getAllByRole("link").length,
    ).toBeGreaterThan(0);
  });
});

describe("following a link lands on /compose with that attachment shown", () => {
  it("the game result opens compose with game 501's summary", async () => {
    const { router, user } = await openGame(GAME, "member");

    const [link] = linksTo(main(), gameFinalAddress(GAME.id));
    expect(link).toBeDefined();
    await user.click(link);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/compose"),
    );
    expect(
      composeTarget(
        `${router.state.location.pathname}${router.state.location.search}`,
      ),
    ).toEqual(gameFinalAddress(GAME.id));
    await screen.findByRole("heading", { name: /^compose$/i });
    const summary = textOf(await summaryShown());
    expect(summary).toMatch(/\b117\b/);
    expect(summary).toMatch(/\b109\b/);
  });

  it("a box-score row opens compose with that player's line", async () => {
    const { router, user } = await openGame(GAME, "member");

    const [link] = linksTo(main(), playerGameAddress(BARNES_LINE_ID, GAME.id));
    expect(link).toBeDefined();
    expect(link).toHaveAccessibleName(/Scottie Barnes/);
    await user.click(link);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/compose"),
    );
    expect(
      composeTarget(
        `${router.state.location.pathname}${router.state.location.search}`,
      ),
    ).toEqual(playerGameAddress(BARNES_LINE_ID, GAME.id));
    await screen.findByRole("heading", { name: /^compose$/i });
    const summary = textOf(await summaryShown());
    expect(summary).toMatch(/Barnes/);
    expect(summary).toMatch(/\b22\b/);
  });
});
