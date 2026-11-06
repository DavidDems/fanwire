/**
 * FRONTEND-036: the home page's right column (the rail), through the real
 * route table, the way `App` mounts it.
 *
 * - **No search bar above the feed, at any width.** The feed's `h1` stays the
 *   page's only one.
 * - **The rail is mounted from 76.0625em only** (`useMediaQuery('(min-width:
 *   76.0625em)')`), so below it nothing of the rail exists and none of its requests
 *   is made. A resize across 1217 px mounts or unmounts it with no reload.
 * - **The rail** is a `complementary` landmark (`<aside>`) inside `main`,
 *   after the feed: the shared `SearchBar`, then, when `?q=` is set, the
 *   results, then a slot `EVENTS-013` fills, which renders nothing here.
 * - **`/?q=` is the rail's address.** A submit on `/` pushes `/?q=<trimmed>`
 *   and stays on `/`; the feed is not refetched and keeps its pages (its
 *   heading is the same element: it did not remount). Back removes the
 *   search. An empty or whitespace-only submit does nothing.
 * - **The results** are a region headed "Results for <q>" (h2), holding the
 *   regions Accounts and Posts in that order (each a section named by its own
 *   heading, h3), at most five rows each from the first page of the existing
 *   `accountsKey`/`postsKey` infinite queries, each ending with a Show all link
 *   to `/search?q=<q>` named for its section, and no Load more.
 * - **Rows.** An account: Avatar and the username as a link to the profile. A
 *   post: author, text, and its time as the link to `/posts/<id>` with the
 *   modal flow's state, so the thread opens over the home page. No controls.
 * - **Clear search** removes `q` with a new history entry and puts focus back
 *   in the search box.
 * - **States.** Loading is the shared StatusLine (`role="status"`) in each
 *   section; a failure is an InlineAlert (`role="alert"`) with Retry in that
 *   section only; no match is an EmptyState naming the query; the count is
 *   announced once per search in a polite live region that is already in the
 *   rail before the search.
 *
 * jsdom has no `matchMedia`: `stubViewport` (`test/search.ts`) stands in for
 * it, one per test, restored after. jsdom computes no layout, so the rail's
 * stickiness, width and the three-line clamp are `shell-css.test.ts`'s and the
 * browser rows'.
 */
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AccountsPageBody } from "../features/search/api";
import { accountsKey, postsKey } from "../features/search/api";
import { renderAppAt, type AppRender } from "../test/app-route";
import {
  allBlocks,
  isAtRule,
  parseCss,
  readSrcFile,
  selectors,
} from "../test/css";
import {
  feedPage,
  feedStub,
  testAuthor,
  testPostView,
  threadView,
  type FeedStub,
  type PostView,
} from "../test/feed";
import {
  accountsPage,
  accountsStub,
  postsPage,
  postsStub,
  stubViewport,
  testAccount,
  type AccountResult,
  type PagedStub,
  type PostsPageBody,
  type ViewportStub,
} from "../test/search";
import { backgroundOf, openDialog, threadServer } from "../test/thread";
import {
  gameDetailStub,
  recentGamesAre,
  testGameDetail,
  testRecentGame,
} from "../test/games";
import shellStyles from "./AppLayout.module.css";
import { server } from "../test/server";

beforeEach(() => server.use(recentGamesAre([])));

const BOX_NAME = "Search accounts and posts";
const WIDE = 1280;
const NARROW = 1216;

const FEED_TEXT = "Tip-off at the baseline";
const OLDER_FEED_TEXT = "Second-half run from the corner";
const FEED_POST = testPostView({ id: 901, text: FEED_TEXT });
const OLDER_FEED_POST = testPostView({ id: 900, text: OLDER_FEED_TEXT });

const AVATAR_KEYS = [
  "court-lines",
  "ball-seams",
  "shot-clock",
  "scoreboard",
  "arc",
  "net-grid",
  "baseline",
] as const;

function accounts(count: number): AccountResult[] {
  return Array.from({ length: count }, (_, index) =>
    testAccount({
      id: 40 + index,
      username: `fan${40 + index}`,
      profile_avatar_key: AVATAR_KEYS[index % AVATAR_KEYS.length],
    }),
  );
}

function posts(count: number): PostView[] {
  return Array.from({ length: count }, (_, index) =>
    testPostView({
      id: 300 + index,
      text: `Result post number ${index}`,
      author: testAuthor({ id: 70 + index, username: `writer${70 + index}` }),
    }),
  );
}

let viewport: ViewportStub | null = null;

function at(width: number): ViewportStub {
  viewport = stubViewport(width);
  return viewport;
}

afterEach(() => {
  viewport?.restore();
  viewport = null;
});

interface Arranged {
  feed: FeedStub;
  accounts: PagedStub<AccountsPageBody>;
  posts: PagedStub<PostsPageBody>;
}

/** The feed (one page by default) and both searches' first pages. */
function arrange(
  options: {
    feedPages?: Parameters<typeof feedStub>[0];
    accountItems?: AccountResult[];
    postItems?: PostView[];
  } = {},
): Arranged {
  const {
    feedPages = [feedPage([FEED_POST], null)],
    accountItems = accounts(2),
    postItems = posts(3),
  } = options;
  return {
    feed: feedStub(feedPages),
    accounts: accountsStub({
      0: accountsPage(accountItems, accountItems.length > 5 ? 99 : null),
    }),
    posts: postsStub({
      0: postsPage(postItems, postItems.length > 5 ? 99 : null),
    }),
  };
}

function handlersOf({ feed, accounts, posts }: Arranged) {
  return [feed.handler, accounts.handler, posts.handler, recentGamesAre([])];
}

describe("recent games in the mounted home rail", () => {
  it("makes no read below R and mounts the section when crossing R", async () => {
    const viewport = at(NARROW);
    let calls = 0;
    const app = renderAppAt("/", "anonymous", [
      http.get("*/events/games/recent", () => {
        calls += 1;
        return HttpResponse.json([testRecentGame()]);
      }),
      ...handlersOf(arrange()),
    ]);
    await feedHeading();
    expect(calls).toBe(0);
    expect(screen.queryByRole("heading", { name: "Recent games" })).toBeNull();
    await act(async () => viewport.setWidth(WIDE));
    expect(
      await within(rail()).findByRole("heading", {
        level: 2,
        name: "Recent games",
      }),
    ).toBeInTheDocument();
    // FRONTEND-037 changed both names: the compact card uses short names
    // ("Raptors", "Suns"), so the city is no longer required.
    await within(rail()).findByRole("link", {
      name: /Raptors.*117|Suns.*109/,
    });
    expect(calls).toBe(1);
    await act(async () => app.router.navigate("/?q=raptors"));
    await results("raptors");
    expect(calls).toBe(1);
  });

  it("a result opens its game over the home page and Escape returns home", async () => {
    at(WIDE);
    const game = testGameDetail();
    const app = renderAppAt("/", "anonymous", [
      recentGamesAre([testRecentGame()]),
      gameDetailStub([game]).handler,
      ...handlersOf(arrange()),
    ]);
    const heading = await feedHeading();
    const link = await within(rail()).findByRole("link", {
      name: /Raptors.*117|Suns.*109/,
    });
    const user = userEvent.setup();
    link.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe(`/games/${game.id}`),
    );
    expect(backgroundOf(app.router)).toMatchObject({ pathname: "/" });
    await waitFor(() => expect(openDialog()).not.toBeNull());
    expect(heading.isConnected).toBe(true);
    // jsdom does not turn Escape into the native dialog cancel event.
    fireEvent(openDialog()!, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
  });
});

async function feedHeading(): Promise<HTMLElement> {
  return screen.findByRole("heading", { level: 1, name: "Feed" });
}

function rail(): HTMLElement {
  return screen.getByRole("complementary");
}

function railBox(): HTMLElement {
  return within(rail()).getByRole("searchbox", { name: BOX_NAME });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Results for raptors", the query optionally in quotes. */
function resultsName(q: string): RegExp {
  return new RegExp(`^Results for [“"‘']?${escape(q)}[”"’']?$`);
}

async function results(q: string): Promise<HTMLElement> {
  return within(rail()).findByRole("region", { name: resultsName(q) });
}

function section(container: HTMLElement, name: "Accounts" | "Posts") {
  return within(container).getByRole("region", { name });
}

function queriesOf(stub: { requests: URLSearchParams[] }): (string | null)[] {
  return stub.requests.map((params) => params.get("q"));
}

function location(app: AppRender): { pathname: string; search: string } {
  const { pathname, search } = app.router.state.location;
  return { pathname, search };
}

async function submitInRail(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
): Promise<void> {
  const box = railBox();
  await user.clear(box);
  if (text !== "") await user.type(box, text);
  await user.click(within(rail()).getByRole("button", { name: "Search" }));
}

/** Every polite live region in the rail: `role="status"` or `aria-live="polite"`. */
function politeRegions(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      '[role="status"], [aria-live="polite"]',
    ),
  ];
}

describe("no search bar above the feed, at any width", () => {
  it.each([320, 360, 640, 1024, 1151])(
    "at %i px: no search box on / at all, and no rail",
    async (width) => {
      at(width);
      const arranged = arrange();
      renderAppAt("/", "anonymous", handlersOf(arranged));

      const heading = await feedHeading();
      await screen.findByText(FEED_TEXT);

      expect(screen.queryByRole("searchbox")).toBeNull();
      expect(screen.queryByRole("search")).toBeNull();
      expect(screen.queryByRole("complementary")).toBeNull();
      expect(screen.getAllByRole("heading", { level: 1 })).toEqual([heading]);
    },
  );

  it.each([1217, 1248, 1280, 1920])(
    "at %i px: the bar is in the rail, beside and after the feed, not above it",
    async (width) => {
      at(width);
      const arranged = arrange();
      renderAppAt("/", "member", handlersOf(arranged));

      const heading = await feedHeading();
      const aside = rail();
      const box = railBox();
      const main = screen.getByRole("main");

      expect(main).toContainElement(aside);
      expect(aside).not.toContainElement(heading);
      expect(screen.getAllByRole("searchbox")).toEqual([box]);
      expect(screen.getAllByRole("search")).toHaveLength(1);
      expect(
        Boolean(
          heading.compareDocumentPosition(aside) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        "the rail follows the feed",
      ).toBe(true);
      // The feed's own section holds no search bar.
      const feedSection = heading.closest("section") as HTMLElement;
      expect(feedSection).not.toBeNull();
      expect(within(feedSection).queryByRole("searchbox")).toBeNull();
      expect(screen.getAllByRole("heading", { level: 1 })).toEqual([heading]);
      expect(screen.getAllByRole("complementary")).toHaveLength(1);
    },
  );
});

describe("the rail is mounted from 76.0625em only", () => {
  it("asks matchMedia for (min-width: 76.0625em)", async () => {
    const stub = at(WIDE);
    renderAppAt("/", "anonymous", handlersOf(arrange()));
    await feedHeading();

    expect(stub.queries.map((query) => query.replace(/\s+/g, ""))).toContain(
      "(min-width:76.0625em)",
    );
  });

  it("below 76.0625em, /?q= shows the feed alone and asks no search", async () => {
    at(NARROW);
    const arranged = arrange();
    renderAppAt("/?q=raptors", "anonymous", handlersOf(arranged));

    await feedHeading();
    await screen.findByText(FEED_TEXT);

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: resultsName("raptors") }),
    ).toBeNull();
    expect(arranged.accounts.requests).toEqual([]);
    expect(arranged.posts.requests).toEqual([]);
  });

  it("widening across 1217 px then shows that search's results, with no reload", async () => {
    const stub = at(NARROW);
    const arranged = arrange();
    const app = renderAppAt("/?q=raptors", "anonymous", handlersOf(arranged));
    const heading = await feedHeading();
    await screen.findByText(FEED_TEXT);
    const entry = app.router.state.location.key;

    stub.setWidth(1217);

    const found = await results("raptors");
    expect(
      await within(section(found, "Accounts")).findByRole("link", {
        name: "fan40",
      }),
    ).toBeInTheDocument();
    expect(railBox()).toHaveValue("raptors");
    expect(queriesOf(arranged.accounts)).toEqual(["raptors"]);
    expect(queriesOf(arranged.posts)).toEqual(["raptors"]);
    // Same entry, same feed: nothing reloaded or refetched.
    expect(app.router.state.location.key).toBe(entry);
    expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
      heading,
    );
    expect(arranged.feed.requests).toHaveLength(1);
  });

  it("narrowing below 1217 px unmounts the rail, and widening to 1217 mounts it again", async () => {
    const stub = at(WIDE);
    renderAppAt("/", "anonymous", handlersOf(arrange()));
    await feedHeading();
    expect(rail()).toBeInTheDocument();

    stub.setWidth(1216);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();

    stub.setWidth(1217);
    expect(rail()).toBeInTheDocument();
  });

  it("is on / only: /search keeps its own bar and no rail", async () => {
    at(WIDE);
    renderAppAt("/search", "anonymous", handlersOf(arrange()));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Search" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getAllByRole("searchbox", { name: BOX_NAME })).toHaveLength(
      1,
    );
  });
});

describe("the rail holds the bar, the results, then an empty slot", () => {
  it("without ?q=: the bar and nothing else (the EVENTS-013 slot renders nothing)", async () => {
    at(WIDE);
    const arranged = arrange();
    renderAppAt("/", "anonymous", handlersOf(arranged));
    await feedHeading();

    const aside = rail();
    const form = within(aside).getByRole("search");
    // The empty recent-games read hides its section after loading settles.
    await waitFor(() =>
      expect(within(aside).queryAllByRole("heading")).toEqual([]),
    );
    expect(within(aside).queryAllByRole("list")).toEqual([]);
    expect(within(aside).queryAllByRole("region")).toEqual([]);
    // All the rail says is the bar's own text: the slot under it is empty.
    expect((aside.textContent ?? "").trim()).toBe(
      (form.textContent ?? "").trim(),
    );
    expect(arranged.accounts.requests).toEqual([]);
    expect(arranged.posts.requests).toEqual([]);
  });

  it("with ?q=: the bar, then the results, and nothing with content after them", async () => {
    at(WIDE);
    renderAppAt("/?q=raptors", "anonymous", handlersOf(arrange()));
    const found = await results("raptors");
    await within(section(found, "Posts")).findAllByRole("listitem");

    const aside = rail();
    const form = within(aside).getByRole("search");
    expect(
      Boolean(
        form.compareDocumentPosition(found) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      "the results follow the bar",
    ).toBe(true);
    // Whatever follows the results in the rail carries no text yet.
    const after = [...aside.querySelectorAll<HTMLElement>("*")].filter(
      (element) =>
        !found.contains(element) &&
        !element.contains(found) &&
        Boolean(
          found.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    );
    expect(
      after.map((element) => (element.textContent ?? "").trim()).join(""),
    ).toBe("");
  });
});

describe("searching on / (the rail's bar)", () => {
  it("pushes /?q=<trimmed text>, stays on /, and keeps the feed and its pages", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const arranged = arrange({
      feedPages: [
        feedPage([FEED_POST], FEED_POST.id),
        feedPage([OLDER_FEED_POST], null),
      ],
    });
    const app = renderAppAt("/", "anonymous", handlersOf(arranged));
    const heading = await feedHeading();
    await screen.findByText(FEED_TEXT);
    await user.click(screen.getByRole("button", { name: /^load more$/i }));
    await screen.findByText(OLDER_FEED_TEXT);
    expect(arranged.feed.requests).toHaveLength(2);
    const before = app.router.state.location.key;

    await submitInRail(user, "  raptors  ");

    await results("raptors");
    expect(location(app)).toEqual({ pathname: "/", search: "?q=raptors" });
    expect(app.router.state.historyAction).toBe("PUSH");
    expect(app.router.state.location.key).not.toBe(before);
    expect(queriesOf(arranged.accounts)).toEqual(["raptors"]);
    expect(queriesOf(arranged.posts)).toEqual(["raptors"]);
    // The feed did not remount, refetch, or lose a page.
    expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
      heading,
    );
    expect(arranged.feed.requests).toHaveLength(2);
    expect(screen.getByText(FEED_TEXT)).toBeInTheDocument();
    expect(screen.getByText(OLDER_FEED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Search" })).toBe(
      null,
    );
  });

  it("encodes the query in the address", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const app = renderAppAt("/", "anonymous", handlersOf(arrange()));
    await feedHeading();

    await submitInRail(user, "raptors & suns");

    await results("raptors & suns");
    expect(app.router.state.location.pathname).toBe("/");
    expect(new URLSearchParams(app.router.state.location.search).get("q")).toBe(
      "raptors & suns",
    );
  });

  it("Back removes the search, and the feed is still not refetched", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const arranged = arrange();
    const app = renderAppAt("/", "anonymous", handlersOf(arranged));
    const heading = await feedHeading();
    await screen.findByText(FEED_TEXT);
    await submitInRail(user, "raptors");
    await results("raptors");

    await act(async () => {
      await app.router.navigate(-1);
    });

    expect(location(app)).toEqual({ pathname: "/", search: "" });
    await waitFor(() =>
      expect(
        within(rail()).queryByRole("region", { name: resultsName("raptors") }),
      ).toBeNull(),
    );
    expect(railBox()).toHaveValue("");
    expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
      heading,
    );
    expect(arranged.feed.requests).toHaveLength(1);
  });

  it.each(["", "   "])("a submit of %j on / does nothing", async (text) => {
    const user = userEvent.setup();
    at(WIDE);
    const arranged = arrange();
    const app = renderAppAt("/", "anonymous", handlersOf(arranged));
    await feedHeading();
    const before = app.router.state.location.key;

    await submitInRail(user, text);

    expect(location(app)).toEqual({ pathname: "/", search: "" });
    expect(app.router.state.location.key).toBe(before);
    expect(within(rail()).queryAllByRole("region")).toEqual([]);
    expect(arranged.accounts.requests).toEqual([]);
    expect(arranged.posts.requests).toEqual([]);
  });

  it.each(["", "   "])(
    "a submit of %j on /search does nothing either",
    async (text) => {
      const user = userEvent.setup();
      at(WIDE);
      const arranged = arrange();
      const app = renderAppAt("/search", "anonymous", handlersOf(arranged));
      await screen.findByRole("heading", { level: 1, name: "Search" });
      const before = app.router.state.location.key;

      const box = screen.getByRole("searchbox", { name: BOX_NAME });
      if (text !== "") await user.type(box, text);
      await user.click(screen.getByRole("button", { name: "Search" }));

      expect(location(app)).toEqual({ pathname: "/search", search: "" });
      expect(app.router.state.location.key).toBe(before);
      expect(arranged.accounts.requests).toEqual([]);
    },
  );

  it("on /search the bar still goes to /search?q=", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const app = renderAppAt("/search", "anonymous", handlersOf(arrange()));
    await screen.findByRole("heading", { level: 1, name: "Search" });

    await user.type(
      screen.getByRole("searchbox", { name: BOX_NAME }),
      " raptors {Enter}",
    );

    await waitFor(() =>
      expect(location(app)).toEqual({
        pathname: "/search",
        search: "?q=raptors",
      }),
    );
  });
});

describe("the rail's results", () => {
  it("are a region headed 'Results for <q>' (h2), Accounts then Posts", async () => {
    at(WIDE);
    renderAppAt("/?q=raptors", "anonymous", handlersOf(arrange()));

    const found = await results("raptors");
    expect(
      within(found).getByRole("heading", {
        level: 2,
        name: resultsName("raptors"),
      }),
    ).toBeInTheDocument();
    const accountsRegion = section(found, "Accounts");
    const postsRegion = section(found, "Posts");
    expect(
      within(accountsRegion).getByRole("heading", {
        level: 3,
        name: "Accounts",
      }),
    ).toBeInTheDocument();
    expect(
      within(postsRegion).getByRole("heading", { level: 3, name: "Posts" }),
    ).toBeInTheDocument();
    expect(
      Boolean(
        accountsRegion.compareDocumentPosition(postsRegion) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      "Accounts come before Posts",
    ).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("show at most five of each from the first page only, with no Load more", async () => {
    at(WIDE);
    const arranged = arrange({
      accountItems: accounts(7),
      postItems: posts(7),
    });
    renderAppAt("/?q=raptors", "anonymous", handlersOf(arranged));

    const found = await results("raptors");
    const accountsRegion = section(found, "Accounts");
    const postsRegion = section(found, "Posts");
    await within(accountsRegion).findByRole("link", { name: "fan40" });
    await within(postsRegion).findByText("Result post number 0");

    expect(within(accountsRegion).getAllByRole("listitem")).toHaveLength(5);
    expect(within(postsRegion).getAllByRole("listitem")).toHaveLength(5);
    expect(within(accountsRegion).queryByRole("link", { name: "fan45" })).toBe(
      null,
    );
    expect(within(postsRegion).queryByText("Result post number 5")).toBe(null);
    expect(within(rail()).queryByRole("button", { name: /load more/i })).toBe(
      null,
    );
    expect(
      arranged.accounts.requests.map((p) => p.get("offset") ?? "0"),
    ).toEqual(["0"]);
    expect(arranged.posts.requests.map((p) => p.get("offset") ?? "0")).toEqual([
      "0",
    ]);
  });

  it("end each section with a Show all link to /search?q=, named for its section", async () => {
    at(WIDE);
    renderAppAt("/?q=raptors", "anonymous", handlersOf(arrange()));
    const found = await results("raptors");

    for (const name of ["Accounts", "Posts"] as const) {
      const region = section(found, name);
      await within(region).findAllByRole("listitem");
      const links = within(region).getAllByRole("link", { name: /show all/i });
      expect(links).toHaveLength(1);
      const [link] = links;
      expect(link.getAttribute("href")).toBe("/search?q=raptors");
      expect(link).toHaveAccessibleName(new RegExp(name, "i"));
      const last = [...region.querySelectorAll("a, button, li")].pop();
      expect(last, `Show all ends ${name}`).toBe(link);
    }
  });

  it("are read from the existing queries' cache, so Show all opens /search with no wait", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const arranged = arrange({
      accountItems: accounts(7),
      postItems: posts(7),
    });
    const app = renderAppAt("/?q=raptors", "anonymous", handlersOf(arranged));
    const found = await results("raptors");
    await within(section(found, "Accounts")).findByRole("link", {
      name: "fan40",
    });
    await within(section(found, "Posts")).findByText("Result post number 0");

    // The same keys and the infinite queries' own shape, first page only.
    for (const key of [accountsKey("raptors"), postsKey("raptors")]) {
      const cached = app.queryClient.getQueryData<{
        pages: unknown[];
        pageParams: unknown[];
      }>(key);
      expect(
        cached,
        `nothing cached under ${JSON.stringify(key)}`,
      ).toBeDefined();
      expect(cached?.pageParams).toEqual([0]);
      expect(cached?.pages).toHaveLength(1);
    }

    await user.click(
      within(section(found, "Accounts")).getByRole("link", {
        name: /show all/i,
      }),
    );

    expect(location(app)).toEqual({
      pathname: "/search",
      search: "?q=raptors",
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Search" }),
    ).toBeInTheDocument();
    // Straight from the cache: rows on the first render, no loading line, and
    // the whole first page (seven) rather than the rail's five.
    const accountsRegion = screen.getByRole("region", { name: "Accounts" });
    expect(within(accountsRegion).queryByRole("status")).toBeNull();
    expect(
      within(accountsRegion).getByRole("link", { name: "fan46" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Posts" })).queryByRole(
        "status",
      ),
    ).toBeNull();
  });

  it("an account row is its Avatar and its username as a link to the profile, and no controls", async () => {
    at(WIDE);
    const items = accounts(2);
    renderAppAt(
      "/?q=raptors",
      "anonymous",
      handlersOf(arrange({ accountItems: items })),
    );
    const region = section(await results("raptors"), "Accounts");
    await within(region).findByRole("link", { name: items[0].username });

    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(items.length);
    rows.forEach((row, index) => {
      const account = items[index];
      expect(
        within(row).getByRole("link", { name: account.username }),
      ).toHaveAttribute("href", `/profile/${account.id}`);
      expect(
        row.querySelector(`[data-avatar-key="${account.profile_avatar_key}"]`),
        `${account.username}'s Avatar`,
      ).not.toBeNull();
      expect(within(row).queryAllByRole("button")).toEqual([]);
    });
  });

  it("a post row is compact: author, text and time, the time linking to /posts/<id>, no controls", async () => {
    at(WIDE);
    const items = posts(2);
    renderAppAt(
      "/?q=raptors",
      "anonymous",
      handlersOf(arrange({ postItems: items })),
    );
    const region = section(await results("raptors"), "Posts");
    await within(region).findByText(items[0].text ?? "");

    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(items.length);
    rows.forEach((row, index) => {
      const post = items[index];
      expect(row).toHaveTextContent(post.author.username);
      expect(row).toHaveTextContent(post.text ?? "");
      const time = row.querySelector("time");
      expect(time, "a <time>").not.toBeNull();
      expect(time).toHaveAttribute("dateTime", post.created_at);
      const link = time?.closest("a");
      expect(link, "the time is a link").not.toBeNull();
      expect(link).toHaveAttribute("href", `/posts/${post.id}`);
      // No like, repost, reply or menu: nothing to press in a row.
      expect(within(row).queryAllByRole("button")).toEqual([]);
      expect(within(row).queryAllByRole("menu")).toEqual([]);
    });
  });

  it("a post row's time opens the thread over the home page (the modal flow)", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const items = posts(1);
    const threads = threadServer([threadView(items[0], [])]);
    const app = renderAppAt("/?q=raptors", "anonymous", [
      ...handlersOf(arrange({ postItems: items })),
      threads.handler,
    ]);
    const heading = await feedHeading();
    const region = section(await results("raptors"), "Posts");
    await within(region).findByText(items[0].text ?? "");

    const link = (region.querySelector("time") as HTMLElement).closest(
      "a",
    ) as HTMLElement;
    await user.click(link);

    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe(`/posts/${items[0].id}`),
    );
    expect(backgroundOf(app.router)).toMatchObject({
      pathname: "/",
      search: "?q=raptors",
    });
    await waitFor(() => expect(openDialog()).not.toBeNull());
    // The home page stays underneath.
    expect(heading.isConnected).toBe(true);
  });

  it("Clear search removes q with a new history entry and returns focus to the box", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const arranged = arrange();
    const app = renderAppAt("/?q=raptors", "anonymous", handlersOf(arranged));
    const heading = await feedHeading();
    await results("raptors");
    const before = app.router.state.location.key;

    await user.click(
      within(rail()).getByRole("button", { name: /^clear search$/i }),
    );

    expect(location(app)).toEqual({ pathname: "/", search: "" });
    expect(app.router.state.historyAction).toBe("PUSH");
    expect(app.router.state.location.key).not.toBe(before);
    await waitFor(() =>
      expect(within(rail()).queryAllByRole("region")).toEqual([]),
    );
    expect(railBox()).toHaveValue("");
    await waitFor(() => expect(document.activeElement).toBe(railBox()));
    expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
      heading,
    );
    expect(arranged.feed.requests).toHaveLength(1);

    // A new entry: Back is the search again.
    await act(async () => {
      await app.router.navigate(-1);
    });
    expect(location(app)).toEqual({ pathname: "/", search: "?q=raptors" });
    expect(await results("raptors")).toBeInTheDocument();
  });

  it("there is no Clear search without a search", async () => {
    at(WIDE);
    renderAppAt("/", "anonymous", handlersOf(arrange()));
    await feedHeading();

    expect(
      within(rail()).queryByRole("button", { name: /clear search/i }),
    ).toBeNull();
  });
});

describe("the rail's loading, failure and empty states", () => {
  it("shows the shared StatusLine in each section while it loads", async () => {
    at(WIDE);
    const arranged = arrange();
    const releaseAccounts = arranged.accounts.hold();
    const releasePosts = arranged.posts.hold();
    try {
      renderAppAt("/?q=raptors", "anonymous", handlersOf(arranged));
      const found = await results("raptors");

      for (const name of ["Accounts", "Posts"] as const) {
        const status = await within(section(found, name)).findByRole("status");
        expect(status.tagName).toBe("P");
        expect((status.textContent ?? "").trim()).not.toBe("");
      }
    } finally {
      releaseAccounts();
      releasePosts();
    }
    const found = await results("raptors");
    await within(section(found, "Accounts")).findByRole("link", {
      name: "fan40",
    });
    expect(within(section(found, "Accounts")).queryByRole("status")).toBeNull();
  });

  it("a failure is an InlineAlert with Retry in that section only, and Retry asks again", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const arranged = arrange();
    let accountsCalls = 0;
    const flakyAccounts = http.get("*/search/accounts", () => {
      accountsCalls += 1;
      if (accountsCalls === 1)
        return HttpResponse.json(
          { detail: "Internal Server Error" },
          { status: 500 },
        );
      return HttpResponse.json(accountsPage(accounts(1), null));
    });
    // msw lets the first matching handler answer: the flaky one replaces
    // arrange()'s accounts stub rather than racing it.
    renderAppAt("/?q=raptors", "anonymous", [
      arranged.feed.handler,
      flakyAccounts,
      arranged.posts.handler,
    ]);
    const found = await results("raptors");
    const accountsRegion = section(found, "Accounts");
    const postsRegion = section(found, "Posts");

    expect(
      await within(accountsRegion).findByRole("alert"),
    ).toBeInTheDocument();
    await within(postsRegion).findByText("Result post number 0");
    expect(within(postsRegion).queryByRole("alert")).toBeNull();
    expect(within(postsRegion).queryByRole("button", { name: /retry/i })).toBe(
      null,
    );

    await user.click(
      within(accountsRegion).getByRole("button", { name: /retry/i }),
    );

    expect(
      await within(section(found, "Accounts")).findByRole("link", {
        name: "fan40",
      }),
    ).toBeInTheDocument();
    expect(within(section(found, "Accounts")).queryByRole("alert")).toBeNull();
    expect(accountsCalls).toBe(2);
    expect(arranged.posts.requests).toHaveLength(1);
  });

  it("no match is an EmptyState naming the query", async () => {
    at(WIDE);
    renderAppAt(
      "/?q=zzqx",
      "anonymous",
      handlersOf(arrange({ accountItems: [], postItems: [] })),
    );
    const found = await results("zzqx");

    await waitFor(() => {
      const naming = within(found)
        .queryAllByText(/zzqx/)
        .filter(
          (element) => element.closest("h1, h2, h3, h4, h5, h6") === null,
        );
      expect(naming, "a message naming the query").not.toEqual([]);
    });
    expect(within(found).queryAllByRole("listitem")).toEqual([]);
    expect(within(found).queryAllByRole("alert")).toEqual([]);
  });
});

describe("the result count is announced once per search", () => {
  it("in a polite live region that waits for both sections, then speaks once", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const arranged = arrange({
      accountItems: accounts(2),
      postItems: posts(3),
    });
    renderAppAt("/", "anonymous", handlersOf(arranged));
    await feedHeading();

    // Before any search the rail already holds the region, silent.
    // The independent recent-games loading status disappears on its empty response.
    await waitFor(() => expect(politeRegions(rail())).toHaveLength(1));
    const regions = politeRegions(rail());
    expect(regions, "one polite live region in the rail").toHaveLength(1);
    const [announcer] = regions;
    expect((announcer.textContent ?? "").trim()).toBe("");

    const spoken: string[] = [];
    const observer = new MutationObserver(() => {
      const text = (announcer.textContent ?? "").trim();
      if (text !== "" && spoken[spoken.length - 1] !== text) spoken.push(text);
    });
    observer.observe(announcer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const releasePosts = arranged.posts.hold();
    try {
      await submitInRail(user, "raptors");
      const found = await results("raptors");
      await within(section(found, "Accounts")).findByRole("link", {
        name: "fan40",
      });
      // Accounts are in, posts are not: nothing is said yet.
      expect((announcer.textContent ?? "").trim()).toBe("");
    } finally {
      releasePosts();
    }

    await waitFor(() =>
      expect((announcer.textContent ?? "").trim()).not.toBe(""),
    );
    await within(section(await results("raptors"), "Posts")).findByText(
      "Result post number 2",
    );
    observer.disconnect();

    expect(announcer.isConnected, "the same region, not a new one").toBe(true);
    expect(spoken).toHaveLength(1);
    const [said] = spoken;
    expect(
      (/\b2\b/.test(said) && /\b3\b/.test(said)) || /\b5\b/.test(said),
      `"${said}" gives the count`,
    ).toBe(true);
  });

  it("a new search is announced anew", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const arranged = arrange({
      accountItems: accounts(2),
      postItems: posts(3),
    });
    renderAppAt("/?q=raptors", "anonymous", handlersOf(arranged));
    await results("raptors");
    const [announcer] = politeRegions(rail()).filter(
      (element) => element.closest('[role="region"], section') === null,
    );
    expect(announcer).toBeDefined();
    await waitFor(() =>
      expect((announcer.textContent ?? "").trim()).not.toBe(""),
    );
    const first = (announcer.textContent ?? "").trim();

    arranged.accounts.setPage(0, accountsPage([], null));
    arranged.posts.setPage(0, postsPage(posts(1), null));
    await submitInRail(user, "suns");
    await results("suns");

    await waitFor(() => {
      const now = (announcer.textContent ?? "").trim();
      expect(now).not.toBe("");
      expect(now).not.toBe(first);
    });
  });
});

/**
 * `main` is widened for the rail on `/` only. jsdom applies no media query,
 * so the shell module's rules under `(min-width: 76.0625em)` that size `main` by
 * `--rail-width` (`shell-css.test.ts` pins that one exists) are matched
 * against the rendered `main`, their module class names mapped to the
 * generated ones, the way `AppLayout.test.tsx` resolves the column.
 */
describe("main is wide enough for the rail on / only", () => {
  function widensMain(): boolean {
    const main = screen.getByRole("main");
    const styles = shellStyles as Record<string, string>;
    const rules = allBlocks(
      parseCss(readSrcFile("routes/AppLayout.module.css")),
    )
      .filter(
        (block) =>
          isAtRule(block) &&
          /\(\s*min-width\s*:\s*76\.0625em\s*\)/i.test(block.prelude),
      )
      .flatMap((media) => allBlocks(media.children))
      .filter(
        (block) =>
          !isAtRule(block) &&
          block.declarations.some(
            ({ property, value }) =>
              /^(max-width|max-inline-size)$/.test(property) &&
              /--rail-width/.test(value),
          ),
      );
    expect(rules, "no 76.0625em rule sizes main by the rail").not.toEqual([]);
    return rules.some((rule) =>
      selectors(rule).some((selector) => {
        const generated = selector
          .replace(/:global\(([^)]*)\)/g, "$1")
          .replace(/\.(-?[_a-zA-Z][\w-]*)/g, (_, name: string) =>
            styles[name] === undefined ? `.${name}` : `.${styles[name]}`,
          );
        try {
          return main.matches(generated);
        } catch {
          return false;
        }
      }),
    );
  }

  it.each(["/", "/?q=raptors"])(
    "%s: main takes the rail's width",
    async (path) => {
      at(WIDE);
      renderAppAt(path, "anonymous", handlersOf(arrange()));
      await feedHeading();
      rail();

      expect(widensMain()).toBe(true);
    },
  );

  it.each([
    ["/search?q=raptors", /^search$/i],
    ["/stats", /^stats$/i],
    ["/stats/records", /^stats$/i],
  ] as const)("%s: main keeps its own width", async (path, heading) => {
    at(WIDE);
    renderAppAt(path, "anonymous", handlersOf(arrange()));
    await screen.findByRole("heading", { level: 1, name: heading });

    expect(widensMain()).toBe(false);
  });

  it("a thread opened over the home page leaves the home page's width alone", async () => {
    const user = userEvent.setup();
    at(WIDE);
    const items = posts(1);
    const threads = threadServer([threadView(items[0], [])]);
    renderAppAt("/?q=raptors", "anonymous", [
      ...handlersOf(arrange({ postItems: items })),
      threads.handler,
    ]);
    const region = section(await results("raptors"), "Posts");
    await within(region).findByText(items[0].text ?? "");
    await user.click(
      (region.querySelector("time") as HTMLElement).closest("a") as HTMLElement,
    );
    await waitFor(() => expect(openDialog()).not.toBeNull());

    expect(widensMain()).toBe(true);
  });
});
