/**
 * FRONTEND-014 criteria 5, 6 and 7, through the real route table: game and
 * player details join FRONTEND-011's one modal flow.
 *
 * - **Opened from a post card**, on a page or inside the modal, `/games/<id>`
 *   and `/players/<id>` render in the one modal surface: one open dialog, the
 *   same element as the thread's, the origin page still mounted underneath.
 *   Back steps to the previous detail; Close and Escape leave the whole flow,
 *   back to the origin's own history entry; focus returns to what opened the
 *   flow's first detail.
 * - **Loaded directly** (no flow state), both are still the full pages they
 *   were: no dialog, no feed underneath.
 * - **Inside the modal, a detail's own links continue the flow**: a legacy
 *   `#GameId` link in a post's text, a box-score player's name, a game-log row.
 *   That includes a flow with no origin (a thread loaded directly, then a game
 *   from it, at depth 2 with no background), which is still in the modal.
 * - **`?line=<line_id>`** marks that box-score row `aria-current="true"` and
 *   scrolls it into view once the game has loaded, on the page and in the
 *   modal; an unknown line marks nothing.
 *
 * Only `modal-flow.tsx`'s behaviour is used: nothing here writes history state
 * by hand except a direct load, which has none. jsdom implements no
 * `scrollIntoView`; it is stubbed per test so a call can be seen.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderAppAt, type AppRouter } from "../test/app-route";
import {
  feedPage,
  feedStub,
  testAuthor,
  testPostView,
  threadView,
} from "../test/feed";
import { gameDetailStub } from "../test/games";
import {
  BARNES_ID,
  BARNES_LINE_ID,
  LEBRON_ID,
  PREVIEW_GAME_ID,
  SECOND_GAME_ID,
  barnesDetail,
  barnesGameLog,
  gameFinalPreview,
  linedGameDetail,
  playerCareerPreview,
  playerGamePreview,
  postWithPreview,
  secondGameDetail,
} from "../test/previews";
import {
  playerDetailStub,
  playerGamesStub,
  testPlayerDetail,
} from "../test/stats";
import {
  backgroundOf,
  cardUnderneath,
  openDialog,
  threadServer,
  timestampLink,
} from "../test/thread";

const ROOT_TEXT = "Raptors in six";
const REPLY_TEXT = "Barnes was everywhere";
const CAREER_TEXT = "The king's numbers";
const MENTION_TEXT = "Rewatching #GameId501 tonight";

const GAME_HREF = `/games/${PREVIEW_GAME_ID}`;
const LINE_HREF = `/games/${PREVIEW_GAME_ID}?line=${BARNES_LINE_ID}`;

/** In the feed and as the thread's root: a game_final preview of game 501. */
const ROOT = postWithPreview(gameFinalPreview(), {
  id: 101,
  text: ROOT_TEXT,
  author: testAuthor({ id: 11, username: "courtside11" }),
  reply_count: 1,
});
/** The root's one reply: Scottie Barnes's line in game 501. */
const REPLY = postWithPreview(playerGamePreview(), {
  id: 111,
  text: REPLY_TEXT,
  is_reply: true,
  parent_post_id: 101,
  author: testAuthor({ id: 12, username: "bench12" }),
  created_at: "2026-09-28T12:05:00Z",
});
/** In the feed: LeBron James's career. */
const CAREER = postWithPreview(playerCareerPreview(), {
  id: 102,
  text: CAREER_TEXT,
  author: testAuthor({ id: 13, username: "king13" }),
  created_at: "2026-09-28T11:00:00Z",
});
/** A legacy post: a `#GameId` mention in its text, no data link. */
const MENTION = testPostView({
  id: 131,
  text: MENTION_TEXT,
  mentioned_game_ids: [PREVIEW_GAME_ID],
  author: testAuthor({ id: 14, username: "legacy14" }),
  created_at: "2026-09-28T10:00:00Z",
});

function handlers() {
  const feed = feedStub([feedPage([ROOT, CAREER, MENTION], null)]);
  const threads = threadServer([
    threadView(ROOT, [REPLY]),
    threadView(REPLY, []),
    threadView(MENTION, []),
  ]);
  const games = gameDetailStub([linedGameDetail(), secondGameDetail()]);
  const players = playerDetailStub([testPlayerDetail(), barnesDetail()]);
  const logs = playerGamesStub({
    [BARNES_ID]: barnesGameLog(),
    [LEBRON_ID]: [],
  });
  return {
    feed,
    threads,
    list: [
      feed.handler,
      threads.handler,
      games.handler,
      players.handler,
      logs.handler,
    ],
  };
}

let scrollTo: ReturnType<typeof vi.spyOn>;
const scrollIntoView = vi.fn();
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  scrollTo.mockRestore();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function dialog(): HTMLElement {
  const open = openDialog();
  if (open === null) throw new Error("no dialog is open");
  return open;
}

function expectOneDialog(): void {
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
}

function feedHeading(): HTMLElement {
  return screen.getByRole("heading", { level: 1, name: "Feed" });
}

async function at(router: AppRouter, path: string): Promise<void> {
  await waitFor(() =>
    expect(
      `${router.state.location.pathname}${router.state.location.search}`,
    ).toBe(path),
  );
}

/** The one link in `root` to `href`. */
function linkTo(root: HTMLElement, href: string): HTMLAnchorElement {
  const links = [...root.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(
    (link) => link.getAttribute("href") === href,
  );
  expect(links, `one link to ${href}`).toHaveLength(1);
  return links[0];
}

/** The top-level card in the dialog holding `text`. */
function cardInDialog(text: string): HTMLElement {
  const card = within(dialog())
    .getAllByRole("article")
    .find(
      (article) =>
        article.parentElement?.closest("article") === null &&
        (article.textContent ?? "").includes(text),
    );
  if (card === undefined)
    throw new Error(`no card in the dialog containing ${JSON.stringify(text)}`);
  return card;
}

function boxScore(root: HTMLElement, team: string): Promise<HTMLElement> {
  return within(root).findByRole("table", {
    name: new RegExp(`${team} box score`),
  });
}

/** Game 501 has loaded in the dialog. */
async function gameInDialog(): Promise<HTMLElement> {
  return boxScore(dialog(), "Toronto Raptors");
}

/** A player has loaded in the dialog. */
async function playerInDialog(name: string): Promise<void> {
  await within(dialog()).findByRole("heading", { name });
}

function pressBack(user: ReturnType<typeof userEvent.setup>) {
  return user.click(within(dialog()).getByRole("button", { name: "Back" }));
}

function pressClose(user: ReturnType<typeof userEvent.setup>) {
  return user.click(within(dialog()).getByRole("button", { name: "Close" }));
}

function pressEscape(): void {
  fireEvent(dialog(), new Event("cancel", { cancelable: true }));
}

/** The feed at `/`, loaded. */
async function onFeed() {
  const user = userEvent.setup();
  const { feed, threads, list } = handlers();
  const app = renderAppAt("/", "anonymous", list);
  await screen.findByText(ROOT_TEXT);
  return {
    user,
    app,
    feed,
    threads,
    origin: { ...app.router.state.location },
    heading: feedHeading(),
    rootCard: cardUnderneath(ROOT_TEXT),
    feedReads: feed.requests.length,
  };
}

type Feed = Awaited<ReturnType<typeof onFeed>>;

/**
 * From the feed: the root's thread, then its game preview, then Scottie
 * Barnes from the box score — three details of one flow.
 */
async function threadGamePlayer() {
  const start = await onFeed();
  const { user, app, rootCard } = start;
  const opener = timestampLink(rootCard);

  await user.click(opener);
  await at(app.router, "/posts/101");
  await within(dialog()).findByText(REPLY_TEXT);
  const surface = dialog();
  const keys = [app.router.state.location.key];

  await user.click(linkTo(cardInDialog(ROOT_TEXT), GAME_HREF));
  await at(app.router, GAME_HREF);
  const table = await gameInDialog();
  keys.push(app.router.state.location.key);

  await user.click(
    within(table).getByRole("link", { name: /^Scottie Barnes$/ }),
  );
  await at(app.router, `/players/${BARNES_ID}`);
  await playerInDialog("Scottie Barnes");
  keys.push(app.router.state.location.key);

  return { ...start, opener, surface, keys };
}

/** Back on the feed's own entry, as it was left, with no dialog. */
async function expectFeedAsLeft(start: Feed): Promise<void> {
  const { app, origin } = start;
  await waitFor(() => expect(openDialog()).toBeNull());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(app.router.state.location.pathname).toBe(origin.pathname);
  expect(app.router.state.location.key).toBe(origin.key);
  expect(feedHeading()).toBe(start.heading);
  expect(cardUnderneath(ROOT_TEXT)).toBe(start.rootCard);
  expect(start.feed.requests).toHaveLength(start.feedReads);
  expect(scrollTo).not.toHaveBeenCalled();
}

describe("thread, then game, then player: one flow in one modal", () => {
  it("has exactly one dialog, the same element, at every step, with the feed underneath", async () => {
    const flow = await threadGamePlayer();

    expectOneDialog();
    expect(openDialog()).toBe(flow.surface);
    expect(feedHeading()).toBe(flow.heading);
    expect(cardUnderneath(ROOT_TEXT)).toBe(flow.rootCard);
    expect(backgroundOf(flow.app.router)?.pathname).toBe("/");
  });

  it("shows the game inside the dialog, not as a page", async () => {
    const { user, app } = await onFeed();
    await user.click(timestampLink(cardUnderneath(ROOT_TEXT)));
    await within(dialog()).findByText(REPLY_TEXT);

    await user.click(linkTo(cardInDialog(ROOT_TEXT), GAME_HREF));

    await at(app.router, GAME_HREF);
    await gameInDialog();
    expectOneDialog();
    // The page underneath is still the feed, and no game page took its place.
    expect(feedHeading()).toBeInTheDocument();
    expect(
      screen
        .queryAllByRole("table")
        .filter((table) => table.closest("dialog") === null),
    ).toEqual([]);
  });

  it("Back steps player → game → thread, the dialog open throughout", async () => {
    const flow = await threadGamePlayer();
    const { user, app, surface, keys } = flow;

    await pressBack(user);
    await at(app.router, GAME_HREF);
    expect(app.router.state.location.key).toBe(keys[1]);
    await gameInDialog();
    expect(openDialog()).toBe(surface);
    expectOneDialog();

    await pressBack(user);
    await at(app.router, "/posts/101");
    expect(app.router.state.location.key).toBe(keys[0]);
    await within(dialog()).findByText(REPLY_TEXT);
    expect(openDialog()).toBe(surface);
    expect(within(dialog()).queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("Close from the player returns to the feed as it was left", async () => {
    const flow = await threadGamePlayer();

    await pressClose(flow.user);

    await expectFeedAsLeft(flow);
  });

  it("Escape from the player returns to the feed as it was left", async () => {
    const flow = await threadGamePlayer();

    pressEscape();

    await expectFeedAsLeft(flow);
  });

  it("returns focus to the timestamp that opened the thread", async () => {
    const flow = await threadGamePlayer();

    await pressClose(flow.user);

    await waitFor(() => expect(openDialog()).toBeNull());
    await waitFor(() => expect(flow.opener).toHaveFocus());
  });
});

describe("a detail opened straight from a card on the page", () => {
  it("a game preview opens the game in the modal over the feed, at the flow's first step", async () => {
    const { user, app, heading, rootCard } = await onFeed();

    await user.click(linkTo(rootCard, GAME_HREF));

    await at(app.router, GAME_HREF);
    await gameInDialog();
    expectOneDialog();
    expect(backgroundOf(app.router)?.pathname).toBe("/");
    expect(feedHeading()).toBe(heading);
    expect(within(dialog()).queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("a career preview opens the player in the modal over the feed", async () => {
    const { user, app } = await onFeed();

    await user.click(
      linkTo(cardUnderneath(CAREER_TEXT), `/players/${LEBRON_ID}`),
    );

    await at(app.router, `/players/${LEBRON_ID}`);
    await playerInDialog("LeBron James");
    expectOneDialog();
    expect(feedHeading()).toBeInTheDocument();
  });

  it("Close returns to the feed and focus to the preview link", async () => {
    const start = await onFeed();
    const opener = linkTo(start.rootCard, GAME_HREF);

    await start.user.click(opener);
    await at(start.app.router, GAME_HREF);
    await gameInDialog();
    await pressClose(start.user);

    await expectFeedAsLeft(start);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("Escape returns to the feed and focus to the preview link", async () => {
    const start = await onFeed();
    const opener = linkTo(cardUnderneath(CAREER_TEXT), `/players/${LEBRON_ID}`);

    await start.user.click(opener);
    await playerInDialog("LeBron James");
    pressEscape();

    await expectFeedAsLeft(start);
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe("links inside a detail continue the flow", () => {
  it("a legacy #GameId link in a thread opens the game in the same dialog, and Back returns to the thread", async () => {
    const { user, app } = await onFeed();
    await user.click(timestampLink(cardUnderneath(MENTION_TEXT)));
    await at(app.router, "/posts/131");
    await within(dialog()).findByText("No replies yet.");
    const surface = dialog();

    await user.click(
      within(cardInDialog("Rewatching")).getByRole("link", {
        name: "#GameId501",
      }),
    );

    await at(app.router, GAME_HREF);
    await gameInDialog();
    expect(openDialog()).toBe(surface);
    expectOneDialog();
    expect(backgroundOf(app.router)?.pathname).toBe("/");

    await pressBack(user);
    await at(app.router, "/posts/131");
    expect(openDialog()).toBe(surface);
  });

  it("a player's game-log row opens that game in the same dialog, and Back returns to the player", async () => {
    const flow = await threadGamePlayer();
    const { user, app, surface } = flow;
    const log = await within(dialog()).findByRole("table", {
      name: /Games played, newest first/,
    });

    await user.click(within(log).getByRole("link"));

    await at(app.router, `/games/${SECOND_GAME_ID}`);
    await within(dialog()).findByText("Footprint Center");
    expect(openDialog()).toBe(surface);
    expectOneDialog();

    await pressBack(user);
    await at(app.router, `/players/${BARNES_ID}`);
    await playerInDialog("Scottie Barnes");
    expect(openDialog()).toBe(surface);
  });

  it("from a thread loaded directly, a game opens in the modal (depth 2, no origin), Back returns, Close lands on /", async () => {
    const user = userEvent.setup();
    const { list } = handlers();
    const app = renderAppAt("/posts/101", "anonymous", list);
    await screen.findByRole("dialog", { name: "Thread" });
    await within(dialog()).findByText(REPLY_TEXT);
    const surface = dialog();

    await user.click(linkTo(cardInDialog(ROOT_TEXT), GAME_HREF));

    await at(app.router, GAME_HREF);
    await gameInDialog();
    expect(openDialog()).toBe(surface);
    expectOneDialog();
    expect(backgroundOf(app.router)).toBeNull();

    await pressBack(user);
    await at(app.router, "/posts/101");
    expect(openDialog()).toBe(surface);

    await user.click(linkTo(cardInDialog(ROOT_TEXT), GAME_HREF));
    await at(app.router, GAME_HREF);
    await gameInDialog();
    await pressClose(user);

    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(
      await screen.findByRole("heading", { level: 1, name: "Feed" }),
    ).toBeInTheDocument();
  });
});

describe("a direct load is still the full page", () => {
  it("/games/<id> renders the game page, with no dialog and no feed", async () => {
    const { list } = handlers();
    renderAppAt(GAME_HREF, "anonymous", list);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /Toronto Raptors/,
      }),
    ).toBeInTheDocument();
    await screen.findByRole("table", { name: /Toronto Raptors box score/ });
    expect(openDialog()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Feed" })).toBeNull();
  });

  it("/players/<id> renders the player page, with no dialog and no feed", async () => {
    const { list } = handlers();
    renderAppAt(`/players/${LEBRON_ID}`, "anonymous", list);

    expect(
      await screen.findByRole("heading", { level: 1, name: "LeBron James" }),
    ).toBeInTheDocument();
    expect(openDialog()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Feed" })).toBeNull();
  });
});

describe("?line=<line_id> marks that player's row", () => {
  /** The `tr` of `name` in `table`. */
  function rowOf(table: HTMLElement, name: string): HTMLTableRowElement {
    const row = within(table)
      .getByRole("link", { name: new RegExp(`^${name}$`) })
      .closest("tr");
    if (row === null) throw new Error(`${name} has no row`);
    return row;
  }

  function marked(root: ParentNode): Element[] {
    return [...root.querySelectorAll("table [aria-current='true']")];
  }

  function scrolledInto(row: HTMLElement): boolean {
    return (scrollIntoView.mock.contexts as unknown[]).some(
      (target) =>
        target instanceof Element && (target === row || row.contains(target)),
    );
  }

  it("on the page: the row is aria-current and scrolled into view once loaded", async () => {
    const { list } = handlers();
    renderAppAt(LINE_HREF, "anonymous", list);
    const table = await screen.findByRole("table", {
      name: /Toronto Raptors box score/,
    });
    const row = rowOf(table, "Scottie Barnes");

    await waitFor(() => expect(row).toHaveAttribute("aria-current", "true"));
    expect(marked(document)).toEqual([row]);
    await waitFor(() => expect(scrolledInto(row)).toBe(true));
    expect(openDialog()).toBeNull();
  });

  it("on the page: an unknown line id marks nothing and scrolls nothing", async () => {
    const { list } = handlers();
    renderAppAt(`${GAME_HREF}?line=99999`, "anonymous", list);
    const table = await screen.findByRole("table", {
      name: /Toronto Raptors box score/,
    });

    expect(rowOf(table, "Scottie Barnes")).not.toHaveAttribute("aria-current");
    expect(marked(document)).toEqual([]);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("on the page: no line marks nothing", async () => {
    const { list } = handlers();
    renderAppAt(GAME_HREF, "anonymous", list);
    await screen.findByRole("table", { name: /Toronto Raptors box score/ });

    expect(marked(document)).toEqual([]);
  });

  it("in the modal: a player_game preview opens the game with that row marked and scrolled to", async () => {
    const { user, app } = await onFeed();
    await user.click(timestampLink(cardUnderneath(ROOT_TEXT)));
    await within(dialog()).findByText(REPLY_TEXT);

    await user.click(linkTo(cardInDialog(REPLY_TEXT), LINE_HREF));

    await at(app.router, LINE_HREF);
    const table = await gameInDialog();
    const row = rowOf(table, "Scottie Barnes");
    await waitFor(() => expect(row).toHaveAttribute("aria-current", "true"));
    expect(marked(dialog())).toEqual([row]);
    await waitFor(() => expect(scrolledInto(row)).toBe(true));
    expectOneDialog();
  });
});
