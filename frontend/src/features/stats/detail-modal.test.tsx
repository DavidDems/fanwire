/**
 * FRONTEND-041: on the Stats page, a game or a player link opens that game or
 * player in the detail modal over the Stats page (FRONTEND-014's flow, as
 * Recent Games does), through the real route table, as a guest.
 *
 * The interface this file pins:
 *
 * - **Every game and player link the Stats page renders** (a team level's
 *   game cards, the Players tab's results, a record level's players and game
 *   dates, Records > Seasonal's leaders) carries the modal flow's link state:
 *   clicked, it opens `/games/<id>` or `/players/<id>` as the one open
 *   dialog, the Stats page still in the document behind it. The address is
 *   the link's own href, unchanged (a team level's game keeps `?season=`).
 * - **The Stats page is not re-mounted.** After Close, Escape or Back the
 *   address is the Stats page's own again, and the same elements show the
 *   same level, season, search text and results; a team level asks for its
 *   team-season no more times than before the game opened. Focus returns to
 *   the link that opened the modal.
 * - **In the modal**, the game's heading team links keep the `?season=` it
 *   was opened with (FRONTEND-037).
 * - **A direct load** of `/games/<id>?season=…` or `/players/<id>` is still the
 *   full page, and a team link on the Stats page stays in-page navigation:
 *   no dialog either way.
 *
 * Only the user's view is used: links are clicked, the dialog is the open
 * `<dialog>`, and Back is the router's own (`router.navigate(-1)`).
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import { teamsAre } from "../../test/auth";
import { renderAppAt, type AppRouter } from "../../test/app-route";
import { gameDetailStub, testGameDetail } from "../../test/games";
import {
  ADEBAYO,
  ADEBAYO_GAME,
  WARRIORS,
  recordDefinition,
} from "../../test/records";
import nav from "../../components/stats-nav/StatsNav.module.css";
import { LUKA } from "../../test/leader-boards";
import { openRecords } from "../../test/records-screen";
import {
  CELTICS,
  championStub,
  leadersStub,
  playerDetailStub,
  playerGamesStub,
  playersStub,
  seasonGamesStub,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testChampion,
  testPlayerDetail,
  testPlayerListItem,
} from "../../test/stats";
import { openDialog } from "../../test/thread";

// The Stats tabs and the details are lazy routes; their chunks are transformed
// once here, outside any test, so no findBy waits on a cold transform.
beforeAll(async () => {
  await Promise.all([
    import("./StatsPage"),
    import("./SeasonsTab"),
    import("./PlayersTab"),
    import("./RecordsTab"),
    import("../games/GamePage"),
    import("../players/PlayerPage"),
  ]);
}, 30_000);

type User = ReturnType<typeof userEvent.setup>;

const LEBRON = testPlayerListItem();

/** Every game a Stats link here opens: the team level's and the record's. */
const GAMES = [
  testGameDetail({ id: 9101, season: "2023-24" }),
  testGameDetail({ id: 9102, season: "2023-24" }),
  testGameDetail({ id: 9103, season: "2023-24" }),
  testGameDetail({ id: ADEBAYO_GAME.id, season: "2025-26" }),
];

/** Every player a Stats link here opens: LeBron, the points leader, Adebayo. */
function detailHandlers() {
  return [
    gameDetailStub(GAMES).handler,
    playerDetailStub([
      testPlayerDetail(),
      testPlayerDetail({
        id: LUKA.player_id,
        first_name: LUKA.first_name,
        last_name: LUKA.last_name,
      }),
      testPlayerDetail({
        id: ADEBAYO.id,
        first_name: ADEBAYO.first_name,
        last_name: ADEBAYO.last_name,
      }),
    ]).handler,
    playerGamesStub({
      [LEBRON.id]: [],
      [LUKA.player_id]: [],
      [ADEBAYO.id]: [],
    }).handler,
  ];
}

function openSeasons(path: string) {
  const teamSeason = teamSeasonStub();
  const app = renderAppAt(path, "anonymous", [
    teamsAre(statsTeams()),
    seasonsStub().handler,
    championStub({ "2023-24": testChampion("2023-24") }).handler,
    standingsStub().handler,
    leadersStub().handler,
    seasonGamesStub().handler,
    teamSeason.handler,
    ...detailHandlers(),
  ]);
  return { ...app, teamSeason };
}

function addressOf(router: AppRouter): string {
  return `${router.state.location.pathname}${router.state.location.search}`;
}

async function at(router: AppRouter, path: string): Promise<void> {
  await waitFor(() => expect(addressOf(router)).toBe(path));
}

/** The open dialog; fails, naming what was expected, when none is open. */
async function dialogOpens(what: string): Promise<HTMLDialogElement> {
  await waitFor(() =>
    expect(openDialog(), `${what} opens in the detail modal`).not.toBeNull(),
  );
  return openDialog() as HTMLDialogElement;
}

async function dialogCloses(): Promise<void> {
  await waitFor(() => expect(openDialog()).toBeNull());
}

/** The page underneath the modal: still in the document, outside any dialog. */
function expectUnderneath(element: HTMLElement): void {
  expect(element.isConnected, "the Stats page is still mounted").toBe(true);
  expect(element.closest("dialog")).toBeNull();
}

/** The one link in `main`, outside any dialog, whose href starts `prefix`. */
function linkIn(root: HTMLElement, prefix: string): HTMLAnchorElement {
  const links = [...root.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(
    (link) =>
      link.closest("dialog") === null &&
      (link.getAttribute("href") ?? "").startsWith(prefix),
  );
  expect(links.length, `a link to ${prefix}`).toBeGreaterThan(0);
  return links[0];
}

function main(): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("main")].find(
    (element) => element.closest("dialog") === null,
  );
  if (found === undefined) throw new Error("no main outside the dialog");
  return found;
}

function pressClose(user: User, dialog: HTMLElement) {
  return user.click(within(dialog).getByRole("button", { name: "Close" }));
}

function pressEscape(dialog: HTMLElement): void {
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
}

/** The game's box score has loaded in `dialog`. */
function gameIn(dialog: HTMLElement): Promise<HTMLElement> {
  return within(dialog).findByRole("table", {
    name: /Toronto Raptors box score/,
  });
}

function playerIn(dialog: HTMLElement, name: string): Promise<HTMLElement> {
  return within(dialog).findByRole("heading", { name });
}

/**
 * The Seasons tab at 2023-24, then the Celtics' team level opened from the
 * standings, in the page: the navigator's own level stack.
 */
async function onTeamLevel() {
  const user = userEvent.setup();
  const app = openSeasons("/stats/seasons?season=2023-24");
  const standings = await screen.findByRole("region", { name: "Standings" });
  await user.click(
    (
      await within(standings).findAllByRole("link", {
        name: new RegExp(CELTICS.name),
      })
    )[0],
  );
  const heading = await screen.findByRole("heading", {
    name: new RegExp(CELTICS.name),
  });
  const opener = await waitFor(() => linkIn(main(), "/games/9101"));
  return {
    user,
    app,
    heading,
    opener,
    address: addressOf(app.router),
    breadcrumb: screen.getByRole("navigation", { name: "Stats path" }),
  };
}

describe("a team level's game card", () => {
  it("opens the game in the modal over the team level, its href (with ?season=) unchanged", async () => {
    const { user, app, heading, opener } = await onTeamLevel();
    const href = opener.getAttribute("href") ?? "";
    expect(new URL(href, "http://x.test").searchParams.get("season")).toBe(
      "2023-24",
    );

    await user.click(opener);

    await at(app.router, href);
    const dialog = await dialogOpens("the game");
    await gameIn(dialog);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    expectUnderneath(heading);
    expect(opener.getAttribute("href")).toBe(href);
  });

  it("Close returns to the same team level and season, with no new team-season request, focus on the card", async () => {
    const { user, app, heading, opener, address, breadcrumb } =
      await onTeamLevel();
    await waitFor(() => expect(app.teamSeason.requests).toHaveLength(1));
    const asked = app.teamSeason.requests.length;

    await user.click(opener);
    const dialog = await dialogOpens("the game");
    await gameIn(dialog);
    await pressClose(user, dialog);

    await dialogCloses();
    await at(app.router, address);
    expect(
      screen.getByRole("heading", { name: new RegExp(CELTICS.name) }),
    ).toBe(heading);
    expect(screen.getByRole("navigation", { name: "Stats path" })).toBe(
      breadcrumb,
    );
    expect(breadcrumb.textContent).toContain("2023-24");
    expect(breadcrumb.textContent).toContain(CELTICS.name);
    expect(screen.getByRole("button", { name: /^back\b/i })).toBeVisible();
    expect(linkIn(main(), "/games/9101")).toBe(opener);
    expect(app.teamSeason.requests).toHaveLength(asked);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("Escape returns to the same team level, focus on the card", async () => {
    const { user, app, heading, opener, address } = await onTeamLevel();

    await user.click(opener);
    const dialog = await dialogOpens("the game");
    await gameIn(dialog);
    pressEscape(dialog);

    await dialogCloses();
    await at(app.router, address);
    expect(heading.isConnected).toBe(true);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps ?season= on the game's heading team links in the modal", async () => {
    const { user, opener } = await onTeamLevel();

    await user.click(opener);
    const dialog = await dialogOpens("the game");
    await gameIn(dialog);

    const teamLinks = within(dialog)
      .getAllByRole("link")
      .filter((link) =>
        (link.getAttribute("href") ?? "").startsWith("/stats/seasons"),
      );
    expect(teamLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of teamLinks) {
      const url = new URL(link.getAttribute("href") ?? "", "http://x.test");
      expect(url.searchParams.get("season")).toBe("2023-24");
    }
  });
});

describe("the Players tab's results", () => {
  function openPlayers() {
    const user = userEvent.setup();
    const app = renderAppAt("/stats/players?q=james", "anonymous", [
      playersStub(() => [LEBRON]).handler,
      ...detailHandlers(),
    ]);
    return { user, app };
  }

  it("a player opens in the modal over the tab; Escape returns to the same search, focus on the link", async () => {
    const { user, app } = openPlayers();
    const box = await screen.findByRole("searchbox", {
      name: "Search players",
    });
    const opener = await waitFor(() => linkIn(main(), `/players/${LEBRON.id}`));
    const address = addressOf(app.router);

    await user.click(opener);

    await at(app.router, `/players/${LEBRON.id}`);
    const dialog = await dialogOpens("the player");
    await playerIn(dialog, "LeBron James");
    expectUnderneath(box);

    pressEscape(dialog);

    await dialogCloses();
    await at(app.router, address);
    expect(screen.getByRole("searchbox", { name: "Search players" })).toBe(box);
    expect(box).toHaveValue("james");
    expect(linkIn(main(), `/players/${LEBRON.id}`)).toBe(opener);
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe("a record level's links", () => {
  async function onRecord(id: string) {
    const user = userEvent.setup();
    const app = openRecords(`/stats/records?record=${id}`, {
      handlers: detailHandlers(),
    });
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: recordDefinition(id).title,
    });
    await waitFor(() =>
      expect(main().querySelectorAll("table")).toHaveLength(1),
    );
    return { user, app, heading, table: main().querySelector("table")! };
  }

  it("a game's date opens the game in the modal; Back returns to the same record level", async () => {
    const { user, app, heading, table } = await onRecord("player-points-game");
    const opener = linkIn(table, `/games/${ADEBAYO_GAME.id}`);
    const href = opener.getAttribute("href") ?? "";
    const address = addressOf(app.router);

    await user.click(opener);

    await at(app.router, href);
    const dialog = await dialogOpens("the game");
    await gameIn(dialog);
    expectUnderneath(heading);

    await app.router.navigate(-1);

    await dialogCloses();
    await at(app.router, address);
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: recordDefinition("player-points-game").title,
      }),
    ).toBe(heading);
    expect(main().querySelector("table")).toBe(table);
  });

  it("a player's name opens the player in the modal over the record level", async () => {
    const { user, app, heading, table } = await onRecord("player-points-game");
    const opener = linkIn(table, `/players/${ADEBAYO.id}`);

    await user.click(opener);

    await at(app.router, `/players/${ADEBAYO.id}`);
    const dialog = await dialogOpens("the player");
    await playerIn(dialog, `${ADEBAYO.first_name} ${ADEBAYO.last_name}`);
    expectUnderneath(heading);
  });

  it("a team link stays in-page navigation: no dialog", async () => {
    const { user, app } = await onRecord("team-best-season");
    const opener = within(main()).getAllByRole("link", {
      name: WARRIORS.name,
    })[0];
    const href = opener.getAttribute("href") ?? "";

    await user.click(opener);

    await at(app.router, href);
    // The Seasons tab's team level replaces the record level in the page.
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", {
          level: 2,
          name: recordDefinition("team-best-season").title,
        }),
      ).toBeNull(),
    );
    expect(openDialog()).toBeNull();
  });
});

// FRONTEND-043 changed this test, which waited on the "Leaders" region's
// three tables and opened the points leader from the first: the leaders are
// cards now, and the points leader opens from the points card's top three.
describe("Records > Seasonal's leaders", () => {
  it("a leader opens in the modal over the cards; Close returns to them, focus on the link", async () => {
    const user = userEvent.setup();
    const app = openRecords("/stats/records?view=seasonal&season=2023-24", {
      handlers: detailHandlers(),
    });
    let leaders: HTMLElement | null = null;
    await waitFor(() => {
      leaders = document.querySelector<HTMLElement>(`main .${nav.cards}`);
      expect(leaders, "the season's leader cards").not.toBeNull();
      linkIn(leaders as HTMLElement, `/players/${LUKA.player_id}`);
    });
    const cards = leaders as unknown as HTMLElement;
    const opener = linkIn(cards, `/players/${LUKA.player_id}`);
    const address = addressOf(app.router);

    await user.click(opener);

    await at(app.router, `/players/${LUKA.player_id}`);
    const dialog = await dialogOpens("the leader");
    await playerIn(dialog, `${LUKA.first_name} ${LUKA.last_name}`);
    expectUnderneath(cards);

    await pressClose(user, dialog);

    await dialogCloses();
    await at(app.router, address);
    expect(document.querySelector(`main .${nav.cards}`)).toBe(cards);
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe("a direct load is still the full page", () => {
  it("/games/<id>?season=… shows the game with no dialog", async () => {
    renderAppAt("/games/9101?season=2023-24", "anonymous", detailHandlers());

    await screen.findByRole("table", { name: /Toronto Raptors box score/ });
    expect(openDialog()).toBeNull();
  });

  it("/players/<id> shows the player with no dialog", async () => {
    renderAppAt(`/players/${LEBRON.id}`, "anonymous", detailHandlers());

    await screen.findByRole("heading", { name: "LeBron James" });
    expect(openDialog()).toBeNull();
  });
});
