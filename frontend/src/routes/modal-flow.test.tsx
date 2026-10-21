/**
 * FRONTEND-011 — the thread modal as one navigation flow over the page it was
 * opened from, through the real route table.
 *
 * A flow is the run of details (`/posts/<id>` entries) opened one from another
 * inside the one modal, starting from an origin page. What is pinned here:
 *
 * - **Close and Escape leave the whole flow**, from any depth, onto the
 *   origin's *own* history entry: the same pathname and search, and the same
 *   entry (its `location.key`, which a fresh navigation to the same address
 *   would not have), so the page underneath is the one the reader left. The
 *   origin is never re-mounted: the same DOM nodes, a second loaded page still
 *   there, no second read, and nothing resets the window's scroll.
 * - **Back steps one detail.** An in-modal control named "Back" is there only
 *   when the flow has a previous detail, and goes one entry back with the
 *   dialog still open. The browser's own Back does the same, and from the first
 *   detail it returns to the origin.
 * - **No origin (a direct load or a reload)**: Close and Escape land on `/`,
 *   at depth 1 and after nesting, and never on an unrelated entry before the
 *   app's own first one.
 * - **Focus** goes back to the control that opened the flow's first detail.
 * - **One surface**: one open `<dialog>` at every step, the same element
 *   throughout.
 * - **Real URLs**: each detail is `/posts/<id>` (with `?reply=1` when opened
 *   to reply), so a copied address opens the same thread directly.
 * - **One module owns the flow's state**: no component under the thread, feed
 *   or search features, nor the background routes, reads `location.state`
 *   itself.
 *
 * jsdom has no layout, so scroll itself is the browser row's
 * (`verification.md`); what is pinned here is its cause: the page is never
 * re-mounted and `window.scrollTo` is never called to reset it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderAppAt,
  renderAppWithHistory,
  type AppRouter,
} from "../test/app-route";
import {
  feedPage,
  feedStub,
  testAuthor,
  testPostView,
  threadView,
} from "../test/feed";
import {
  accountsPage,
  accountsStub,
  postsPage,
  postsStub,
} from "../test/search";
import {
  cardUnderneath,
  openDialog,
  threadServer,
  timestampLink,
} from "../test/thread";

const ROOT_TEXT = "Raptors in six";
const REPLY_TEXT = "Bench mob wins it";
const DEEP_TEXT = "Deeper still";
const OLDER_TEXT = "Older take from page two";

const ROOT = testPostView({
  id: 101,
  text: ROOT_TEXT,
  author: testAuthor({ id: 11, username: "courtside11" }),
  reply_count: 1,
});
const REPLY = testPostView({
  id: 111,
  text: REPLY_TEXT,
  is_reply: true,
  parent_post_id: 101,
  author: testAuthor({ id: 12, username: "bench12" }),
  created_at: "2026-09-28T12:05:00Z",
  reply_count: 1,
});
const DEEP = testPostView({
  id: 121,
  text: DEEP_TEXT,
  is_reply: true,
  parent_post_id: 111,
  author: testAuthor({ id: 13, username: "deep13" }),
  created_at: "2026-09-28T12:07:00Z",
});
const OLDER = testPostView({
  id: 90,
  text: OLDER_TEXT,
  author: testAuthor({ id: 14, username: "older14" }),
  created_at: "2026-09-27T12:00:00Z",
});

function threads() {
  return threadServer([
    threadView(ROOT, [REPLY]),
    threadView(REPLY, [DEEP]),
    threadView(DEEP, []),
  ]);
}

let scrollTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom logs "not implemented" for it; a spy that does nothing records
  // whether anything tried to reset the page's scroll.
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  scrollTo.mockRestore();
});

function thread(): HTMLElement {
  const dialog = openDialog();
  if (dialog === null) throw new Error("no dialog is open");
  return dialog;
}

/** The top-level card in the open dialog holding `text`. */
function cardInDialog(text: string): HTMLElement {
  const card = within(thread())
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

function feedHeading(): HTMLElement {
  return screen.getByRole("heading", { level: 1, name: "Feed" });
}

function expectOneDialog(): void {
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
}

async function atDetail(router: AppRouter, postId: number): Promise<void> {
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/posts/${postId}`),
  );
}

/** Wait until the detail for `postId` has loaded in the dialog. */
async function loaded(postId: number): Promise<void> {
  const text =
    postId === 101
      ? REPLY_TEXT
      : postId === 111
        ? DEEP_TEXT
        : "No replies yet.";
  await waitFor(() => expect(within(thread()).getByText(text)).toBeVisible());
}

/** From detail 101, open 111 by its reply's timestamp. */
async function nestOnce(
  user: ReturnType<typeof userEvent.setup>,
  router: AppRouter,
): Promise<void> {
  await loaded(101);
  await user.click(timestampLink(cardInDialog(REPLY_TEXT)));
  await atDetail(router, 111);
  await loaded(111);
}

/** From detail 111, open 121 by its reply's timestamp. */
async function nestTwice(
  user: ReturnType<typeof userEvent.setup>,
  router: AppRouter,
): Promise<void> {
  await user.click(timestampLink(cardInDialog(DEEP_TEXT)));
  await atDetail(router, 121);
  await loaded(121);
}

/**
 * The feed at `/` with its second page loaded, and a flow opened from the
 * root's timestamp to `depth` details: 101, then 111, then 121.
 */
async function flowFromFeed(depth: 1 | 2 | 3) {
  const user = userEvent.setup();
  const feed = feedStub([feedPage([ROOT], 100), feedPage([OLDER], null)]);
  const server = threads();
  const app = renderAppAt("/", "anonymous", [feed.handler, server.handler]);
  await screen.findByText(ROOT_TEXT);
  await user.click(screen.getByRole("button", { name: /load more/i }));
  await screen.findByText(OLDER_TEXT);

  const origin = { ...app.router.state.location };
  const heading = feedHeading();
  const card = cardUnderneath(ROOT_TEXT);
  const older = cardUnderneath(OLDER_TEXT);
  const opener = timestampLink(card);
  const feedReads = feed.requests.length;

  await user.click(opener);
  await atDetail(app.router, 101);
  const dialog = thread();
  const keys = [app.router.state.location.key];
  if (depth >= 2) {
    await nestOnce(user, app.router);
    keys.push(app.router.state.location.key);
  }
  if (depth >= 3) {
    await nestTwice(user, app.router);
    keys.push(app.router.state.location.key);
  }

  return {
    user,
    app,
    feed,
    feedReads,
    origin,
    heading,
    card,
    older,
    opener,
    dialog,
    keys,
  };
}

type Flow = Awaited<ReturnType<typeof flowFromFeed>>;

function pressClose(user: Flow["user"]): Promise<void> {
  return user.click(within(thread()).getByRole("button", { name: "Close" }));
}

function pressEscape(): void {
  fireEvent(thread(), new Event("cancel", { cancelable: true }));
}

/** Back on the feed's own entry, with the feed exactly as it was left. */
async function expectFeedAsLeft(flow: Flow): Promise<void> {
  const { app, origin } = flow;
  await waitFor(() => expect(openDialog()).toBeNull());
  expect(app.router.state.location.pathname).toBe(origin.pathname);
  expect(app.router.state.location.search).toBe(origin.search);
  // The same history entry the flow started from, not a new one at "/".
  expect(app.router.state.location.key).toBe(origin.key);
  expect(app.router.state.historyAction).toBe("POP");
  expect(screen.queryByRole("dialog")).toBeNull();
  // Not re-mounted: the same nodes, both loaded pages, no second read.
  expect(feedHeading()).toBe(flow.heading);
  expect(cardUnderneath(ROOT_TEXT)).toBe(flow.card);
  expect(cardUnderneath(OLDER_TEXT)).toBe(flow.older);
  expect(flow.feed.requests).toHaveLength(flow.feedReads);
  expect(scrollTo).not.toHaveBeenCalled();
}

describe("Close leaves the whole flow, back to the origin as it was", () => {
  it.each([1, 2, 3] as const)(
    "from depth %i, the Close button returns to the feed's own entry",
    async (depth) => {
      const flow = await flowFromFeed(depth);

      await pressClose(flow.user);

      await expectFeedAsLeft(flow);
    },
  );
});

describe("Escape does exactly what Close does", () => {
  it.each([1, 2, 3] as const)(
    "from depth %i, Escape returns to the feed's own entry",
    async (depth) => {
      const flow = await flowFromFeed(depth);

      pressEscape();

      await expectFeedAsLeft(flow);
    },
  );
});

describe("the in-modal Back control", () => {
  it("is not there at the flow's first detail", async () => {
    await flowFromFeed(1);

    expect(within(thread()).queryByRole("button", { name: "Back" })).toBeNull();
  });

  it.each([2, 3] as const)("is there at depth %i", async (depth) => {
    await flowFromFeed(depth);

    expect(
      within(thread()).getByRole("button", { name: "Back" }),
    ).toBeInTheDocument();
  });

  it("steps one detail back from depth 2, with the dialog still open", async () => {
    const { user, app, dialog, keys } = await flowFromFeed(2);

    await user.click(within(thread()).getByRole("button", { name: "Back" }));

    await atDetail(app.router, 101);
    expect(app.router.state.location.key).toBe(keys[0]);
    expect(app.router.state.historyAction).toBe("POP");
    expect(openDialog()).toBe(dialog);
    expectOneDialog();
    await loaded(101);
    // Back at the first detail: no previous one to step to.
    expect(within(thread()).queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("steps one detail back from depth 3, and is still offered at depth 2", async () => {
    const { user, app, dialog, keys } = await flowFromFeed(3);

    await user.click(within(thread()).getByRole("button", { name: "Back" }));

    await atDetail(app.router, 111);
    expect(app.router.state.location.key).toBe(keys[1]);
    expect(openDialog()).toBe(dialog);
    await loaded(111);
    expect(
      within(thread()).getByRole("button", { name: "Back" }),
    ).toBeInTheDocument();
  });

  it("then Close still leaves the whole flow to the origin", async () => {
    const flow = await flowFromFeed(3);

    await flow.user.click(
      within(thread()).getByRole("button", { name: "Back" }),
    );
    await atDetail(flow.app.router, 111);
    await loaded(111);
    await pressClose(flow.user);

    await expectFeedAsLeft(flow);
  });
});

describe("the browser's own Back", () => {
  async function browserBack(router: AppRouter): Promise<void> {
    await act(async () => {
      await router.navigate(-1);
    });
  }

  it("steps one detail at a time, and from the first detail returns to the origin", async () => {
    const flow = await flowFromFeed(3);
    const { app, dialog } = flow;

    await browserBack(app.router);
    await atDetail(app.router, 111);
    expect(openDialog()).toBe(dialog);
    expectOneDialog();

    await browserBack(app.router);
    await atDetail(app.router, 101);
    expect(openDialog()).toBe(dialog);
    expectOneDialog();

    await browserBack(app.router);
    await expectFeedAsLeft(flow);
  });

  it("leaves a flow whose Close still goes to the origin from where it stopped", async () => {
    const flow = await flowFromFeed(3);

    await browserBack(flow.app.router);
    await atDetail(flow.app.router, 111);
    await loaded(111);
    pressEscape();

    await expectFeedAsLeft(flow);
  });
});

describe("focus after the flow closes", () => {
  it("returns to the timestamp that opened the first detail, after Close from depth 3", async () => {
    const { user, opener } = await flowFromFeed(3);

    await pressClose(user);

    await waitFor(() => expect(openDialog()).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("returns to the same opener after Escape from depth 3", async () => {
    const { opener } = await flowFromFeed(3);

    pressEscape();

    await waitFor(() => expect(openDialog()).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe("one modal surface", () => {
  it("has exactly one open dialog, the same element, at every depth", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([ROOT], null)]);
    const server = threads();
    const app = renderAppAt("/", "anonymous", [feed.handler, server.handler]);
    await screen.findByText(ROOT_TEXT);
    expect(openDialog()).toBeNull();

    await user.click(timestampLink(cardUnderneath(ROOT_TEXT)));
    await atDetail(app.router, 101);
    const dialog = thread();
    expectOneDialog();

    await nestOnce(user, app.router);
    expectOneDialog();
    expect(openDialog()).toBe(dialog);
    expect(document.querySelectorAll("dialog")).toHaveLength(1);

    await nestTwice(user, app.router);
    expectOneDialog();
    expect(openDialog()).toBe(dialog);
    expect(document.querySelectorAll("dialog")).toHaveLength(1);

    await user.click(within(thread()).getByRole("button", { name: "Back" }));
    await atDetail(app.router, 111);
    expectOneDialog();
    expect(openDialog()).toBe(dialog);

    await pressClose(user);
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(document.querySelectorAll("dialog")).toHaveLength(0);
  });
});

describe("each detail keeps its real URL", () => {
  it("is /posts/<id> at every depth, and the links inside say so", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([ROOT], null)]);
    const server = threads();
    const app = renderAppAt("/", "anonymous", [feed.handler, server.handler]);
    await screen.findByText(ROOT_TEXT);

    await user.click(timestampLink(cardUnderneath(ROOT_TEXT)));
    await atDetail(app.router, 101);
    expect(app.router.state.location.search).toBe("");
    await loaded(101);
    expect(timestampLink(cardInDialog(REPLY_TEXT))).toHaveAttribute(
      "href",
      "/posts/111",
    );
    expect(
      within(cardInDialog(REPLY_TEXT)).getByRole("link", { name: "Reply" }),
    ).toHaveAttribute("href", "/posts/111?reply=1");

    await nestOnce(user, app.router);
    expect(app.router.state.location.search).toBe("");
  });

  it("opens a reply's thread to reply as /posts/<id>?reply=1, and Close still returns to the origin", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([ROOT], null)]);
    const server = threads();
    const app = renderAppAt("/", "member", [feed.handler, server.handler]);
    await screen.findByText(ROOT_TEXT);
    const originKey = app.router.state.location.key;

    await user.click(
      within(cardUnderneath(ROOT_TEXT)).getByRole("link", { name: "Reply" }),
    );
    await atDetail(app.router, 101);
    expect(app.router.state.location.search).toBe("?reply=1");
    await loaded(101);

    await user.click(
      within(cardInDialog(REPLY_TEXT)).getByRole("link", { name: "Reply" }),
    );
    await atDetail(app.router, 111);
    expect(app.router.state.location.search).toBe("?reply=1");
    expect(
      within(thread()).getByRole("button", { name: "Back" }),
    ).toBeInTheDocument();

    await pressClose(user);

    await waitFor(() => expect(openDialog()).toBeNull());
    expect(app.router.state.location.pathname).toBe("/");
    expect(app.router.state.location.search).toBe("");
    expect(app.router.state.location.key).toBe(originKey);
  });

  it("counts a click on a reply's card as a step of the same flow", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([ROOT], null)]);
    const server = threads();
    const app = renderAppAt("/", "anonymous", [feed.handler, server.handler]);
    await screen.findByText(ROOT_TEXT);
    const originKey = app.router.state.location.key;

    await user.click(timestampLink(cardUnderneath(ROOT_TEXT)));
    await loaded(101);
    await user.click(within(cardInDialog(REPLY_TEXT)).getByText(REPLY_TEXT));
    await atDetail(app.router, 111);
    await loaded(111);

    pressEscape();

    await waitFor(() => expect(openDialog()).toBeNull());
    expect(app.router.state.location.pathname).toBe("/");
    expect(app.router.state.location.key).toBe(originKey);
  });
});

describe("a flow opened from search", () => {
  const FIRST_TEXT = "Raptors in six, again";
  const SECOND_TEXT = "Raptors depth chart";
  const NESTED_TEXT = "Agreed on the depth";
  const FIRST = testPostView({
    id: 201,
    text: FIRST_TEXT,
    author: testAuthor({ id: 12, username: "courtside12" }),
    reply_count: 1,
  });
  const SECOND = testPostView({
    id: 202,
    text: SECOND_TEXT,
    author: testAuthor({ id: 15, username: "depth15" }),
  });
  const NESTED = testPostView({
    id: 211,
    text: NESTED_TEXT,
    is_reply: true,
    parent_post_id: 201,
    author: testAuthor({ id: 16, username: "nested16" }),
    created_at: "2026-09-28T12:05:00Z",
  });

  it("restores /search with its query and both loaded pages after Close from a nested thread", async () => {
    const user = userEvent.setup();
    const accounts = accountsStub({ 0: accountsPage([], null) });
    const posts = postsStub({
      0: postsPage([FIRST], 20),
      20: postsPage([SECOND], null),
    });
    const server = threadServer([
      threadView(FIRST, [NESTED]),
      threadView(NESTED, []),
    ]);
    const app = renderAppAt("/search?q=raptors", "anonymous", [
      accounts.handler,
      posts.handler,
      server.handler,
    ]);
    await screen.findByText(FIRST_TEXT);
    await user.click(screen.getByRole("button", { name: "Load more posts" }));
    await screen.findByText(SECOND_TEXT);
    const originKey = app.router.state.location.key;
    const heading = screen.getByRole("heading", { level: 1, name: "Search" });
    const first = cardUnderneath(FIRST_TEXT);
    const second = cardUnderneath(SECOND_TEXT);
    const reads = posts.requests.length;

    await user.click(timestampLink(first));
    await atDetail(app.router, 201);
    await waitFor(() =>
      expect(within(thread()).getByText(NESTED_TEXT)).toBeVisible(),
    );
    await user.click(timestampLink(cardInDialog(NESTED_TEXT)));
    await atDetail(app.router, 211);
    await waitFor(() =>
      expect(within(thread()).getByText("No replies yet.")).toBeVisible(),
    );

    await pressClose(user);

    await waitFor(() => expect(openDialog()).toBeNull());
    expect(app.router.state.location.pathname).toBe("/search");
    expect(app.router.state.location.search).toBe("?q=raptors");
    expect(app.router.state.location.key).toBe(originKey);
    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBe(
      heading,
    );
    expect(cardUnderneath(FIRST_TEXT)).toBe(first);
    expect(cardUnderneath(SECOND_TEXT)).toBe(second);
    expect(posts.requests).toHaveLength(reads);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("a flow with no origin (a direct load or a reload)", () => {
  /** `/posts/101` loaded directly, with an unrelated entry before it. */
  function directLoad() {
    const feed = feedStub([feedPage([ROOT], null)]);
    const server = threads();
    const app = renderAppWithHistory(
      { initialEntries: ["/unrelated", "/posts/101"], initialIndex: 1 },
      "anonymous",
      [feed.handler, server.handler],
    );
    const visited: string[] = [];
    const unsubscribe = app.router.subscribe((state) => {
      visited.push(state.location.pathname);
    });
    return { app, visited, unsubscribe, user: userEvent.setup() };
  }

  async function expectHome(
    router: AppRouter,
    visited: string[],
  ): Promise<void> {
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(visited).not.toContain("/unrelated");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Feed" }),
    ).toBeInTheDocument();
  }

  it.each(["Close", "Escape"] as const)(
    "at depth 1, %s lands on / and never on the unrelated entry",
    async (how) => {
      const { app, visited, unsubscribe, user } = directLoad();
      await screen.findByRole("dialog", { name: "Thread" });
      await loaded(101);

      if (how === "Close") await pressClose(user);
      else pressEscape();

      await expectHome(app.router, visited);
      unsubscribe();
    },
  );

  it.each(["Close", "Escape"] as const)(
    "after nesting, %s lands on / and never on the unrelated entry",
    async (how) => {
      const { app, visited, unsubscribe, user } = directLoad();
      await screen.findByRole("dialog", { name: "Thread" });
      await nestOnce(user, app.router);
      await nestTwice(user, app.router);

      if (how === "Close") await pressClose(user);
      else pressEscape();

      await expectHome(app.router, visited);
      unsubscribe();
    },
  );

  it("shows Back at a nested detail of a direct load", async () => {
    const { app, unsubscribe, user } = directLoad();
    await screen.findByRole("dialog", { name: "Thread" });
    await loaded(101);
    expect(within(thread()).queryByRole("button", { name: "Back" })).toBeNull();

    await nestOnce(user, app.router);

    expect(
      within(thread()).getByRole("button", { name: "Back" }),
    ).toBeInTheDocument();
    unsubscribe();
  });

  it("leaves no detail of the closed flow behind the home entry", async () => {
    const { app, unsubscribe, user } = directLoad();
    await screen.findByRole("dialog", { name: "Thread" });
    await nestOnce(user, app.router);
    await pressClose(user);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    await waitFor(() => expect(openDialog()).toBeNull());

    // `/` replaced the flow's first entry, so the browser's Back goes to
    // what was before the app, not into the flow that was just closed.
    await act(async () => {
      await app.router.navigate(-1);
    });

    expect(app.router.state.location.pathname).not.toMatch(/^\/posts\//);
    expect(openDialog()).toBeNull();
    unsubscribe();
  });
});

describe("the flow's state is read through one module", () => {
  function findSrcDir(): string {
    for (const candidate of [
      join(process.cwd(), "src"),
      join(process.cwd(), "frontend", "src"),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`cannot locate frontend/src from ${process.cwd()}`);
  }

  function sourceFiles(directory: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        found.push(...sourceFiles(full));
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        found.push(full);
      }
    }
    return found;
  }

  /** Reading the history state directly, in any of the usual spellings. */
  const READS_STATE = [
    /\blocation\.state\b/,
    /useLocation\(\)\.state\b/,
    /\bstate\s+as\b/,
    /\{[^}]*\bstate\b[^}]*\}\s*=\s*useLocation\(\)/,
  ];

  it("no component under thread, feed or search, nor BackgroundRoutes, reads location.state itself", () => {
    const src = findSrcDir();
    const files = [
      ...["thread", "feed", "search"].flatMap((feature) =>
        sourceFiles(join(src, "features", feature)),
      ),
      join(src, "routes", "BackgroundRoutes.tsx"),
    ];
    expect(files.length).toBeGreaterThan(5);

    const offenders = files
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return READS_STATE.some((pattern) => pattern.test(text));
      })
      .map((file) => relative(src, file).split(sep).join("/"));

    expect(offenders).toEqual([]);
  });
});
