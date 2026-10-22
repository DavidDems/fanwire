/**
 * FRONTEND-017 criteria 3, 4 and 5 (the player page's half): "Post about
 * this" on each career line of `/players/<id>`.
 *
 * Through the real route table (`renderAppAt`), as `PlayerPage.test.tsx`
 * does; the end-to-end tests follow each link into the real `/compose` route
 * and `FRONTEND-013`'s parser. Nothing here imports the page or the composer.
 *
 * The interface this file pins:
 *
 * - **One per career row.** In the table captioned /career/i, the Regular
 *   season row and the Playoffs row each hold exactly one /post about/i link,
 *   to `/compose?link=player_career&ref=<player id>&scope=regular` and
 *   `…&scope=playoffs` respectively. Each link's accessible name says what the
 *   post is about: it names the player and its own scope (/regular/i,
 *   /playoff/i), so the two read differently out of context.
 * - **Only a scope with games.** A scope whose `games_played` is 0 has no link.
 * - **Signed out**, there is none.
 * - Addresses are compared as a path and a set of parameters
 *   (`src/test/post-about.ts`).
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt, type Visitor } from "../../test/app-route";
import { attachServer, summaryShown, textOf } from "../../test/attach";
import {
  composeLinks,
  composeTarget,
  playerCareerAddress,
  postAboutLinks,
  signedInShown,
  signedOutShown,
} from "../../test/post-about";
import {
  testPlayerDetail,
  testStatLine,
  type PlayerDetailOut,
} from "../../test/stats";
import { bodyRows, tableCaptioned } from "../../test/tables";

const LEBRON = testPlayerDetail();

function main(): HTMLElement {
  return screen.getByRole("main");
}

async function openPlayer(as: Visitor, player: PlayerDetailOut = LEBRON) {
  const { handlers } = attachServer({ career: player });
  const rendered = renderAppAt(`/players/${player.id}`, as, handlers);
  await screen.findByRole("heading", { level: 1, name: "LeBron James" });
  if (as === "anonymous") await signedOutShown();
  else await signedInShown();
  return { router: rendered.router, user: userEvent.setup() };
}

function careerRows(): { regular: HTMLElement; playoffs: HTMLElement } {
  const rows = bodyRows(tableCaptioned(main(), /career/i));
  const header = (row: HTMLTableRowElement) =>
    row.querySelector('th[scope="row"]')?.textContent ?? "";
  const regular = rows.find((row) => /regular/i.test(header(row)));
  const playoffs = rows.find((row) => /playoffs/i.test(header(row)));
  if (regular === undefined || playoffs === undefined)
    throw new Error("no regular-season or playoffs career row");
  return { regular, playoffs };
}

describe("each career row: a 'Post about this' link, signed in", () => {
  it("the Regular season row links to scope=regular", async () => {
    await openPlayer("member");
    const { regular } = careerRows();

    const links = postAboutLinks(regular);
    expect(links).toHaveLength(1);
    expect(composeTarget(links[0].getAttribute("href"))).toEqual(
      playerCareerAddress(LEBRON.id, "regular"),
    );
    expect(composeLinks(regular)).toHaveLength(1);
  });

  it("the Playoffs row links to scope=playoffs", async () => {
    await openPlayer("member");
    const { playoffs } = careerRows();

    const links = postAboutLinks(playoffs);
    expect(links).toHaveLength(1);
    expect(composeTarget(links[0].getAttribute("href"))).toEqual(
      playerCareerAddress(LEBRON.id, "playoffs"),
    );
    expect(composeLinks(playoffs)).toHaveLength(1);
  });

  it("each link's name says whose career, and which part of it", async () => {
    await openPlayer("member");
    const { regular, playoffs } = careerRows();

    const [toRegular] = postAboutLinks(regular);
    const [toPlayoffs] = postAboutLinks(playoffs);
    expect(toRegular).toHaveAccessibleName(/LeBron James/);
    expect(toRegular).toHaveAccessibleName(/regular/i);
    expect(toPlayoffs).toHaveAccessibleName(/LeBron James/);
    expect(toPlayoffs).toHaveAccessibleName(/playoff/i);
  });

  it("the career table holds just those two", async () => {
    await openPlayer("member");

    expect(composeLinks(tableCaptioned(main(), /career/i))).toHaveLength(2);
  });
});

describe("a scope with no games has no link", () => {
  it("no playoff games: the Playoffs row has none, Regular season still has its own", async () => {
    await openPlayer(
      "member",
      testPlayerDetail({ career_playoffs: testStatLine({ games_played: 0 }) }),
    );
    const { regular, playoffs } = careerRows();

    expect(composeLinks(playoffs)).toEqual([]);
    expect(postAboutLinks(playoffs)).toEqual([]);
    expect(
      composeTarget(postAboutLinks(regular)[0]?.getAttribute("href")),
    ).toEqual(playerCareerAddress(LEBRON.id, "regular"));
    const scopes = composeLinks(main()).flatMap((link) =>
      composeTarget(link.getAttribute("href"))
        .params.filter(([key]) => key === "scope")
        .map(([, value]) => value),
    );
    expect(scopes).not.toContain("playoffs");
  });

  it("no regular-season games: the Regular season row has none", async () => {
    await openPlayer(
      "member",
      testPlayerDetail({ career_regular: testStatLine({ games_played: 0 }) }),
    );
    const { regular, playoffs } = careerRows();

    expect(composeLinks(regular)).toEqual([]);
    expect(postAboutLinks(regular)).toEqual([]);
    expect(
      composeTarget(postAboutLinks(playoffs)[0]?.getAttribute("href")),
    ).toEqual(playerCareerAddress(LEBRON.id, "playoffs"));
  });
});

describe("signed out, the player page offers none of these links", () => {
  it("shows no link to compose", async () => {
    await openPlayer("anonymous");

    expect(composeLinks(main())).toEqual([]);
    expect(postAboutLinks(main())).toEqual([]);
    // The page is otherwise there.
    expect(careerRows().regular).toBeInTheDocument();
  });
});

describe("following a link lands on /compose with that career attached", () => {
  it.each([
    ["regular", /regular/i, /1,?492/],
    ["playoffs", /playoffs/i, /\b287\b/],
  ] as const)(
    "the %s link opens compose with that scope's summary",
    async (scope, scopeName, games) => {
      const { router, user } = await openPlayer("member");
      const rows = careerRows();

      const [link] = postAboutLinks(
        scope === "regular" ? rows.regular : rows.playoffs,
      );
      expect(link).toBeDefined();
      await user.click(link);

      await waitFor(() =>
        expect(router.state.location.pathname).toBe("/compose"),
      );
      expect(
        composeTarget(
          `${router.state.location.pathname}${router.state.location.search}`,
        ),
      ).toEqual(playerCareerAddress(LEBRON.id, scope));
      await screen.findByRole("heading", { name: /^compose$/i });
      const summary = textOf(await summaryShown());
      expect(summary).toMatch(/LeBron James/);
      expect(summary).toMatch(scopeName);
      expect(summary).toMatch(games);
    },
  );
});
