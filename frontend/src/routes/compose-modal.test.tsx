/**
 * FRONTEND-020 — compose as an overlay route, through the real route table.
 *
 * - **Over the page it was opened from.** The floating + ("Compose a post",
 *   a button in FloatingButton's onClick form, for an active account only)
 *   opens `/compose` as UI-010's Dialog titled "Compose" over the page the
 *   reader is on, which stays mounted and unchanged underneath: the same DOM
 *   nodes, no second read, no scroll reset (`modal-flow.test.tsx`'s pattern).
 *   One "Compose" heading: the dialog's own.
 * - **A direct load or a reload** of any `/compose` address (`?link=`,
 *   `?reply_to=`, `?repost_of=` too) opens it over the feed.
 * - **From inside the detail modal** ("Post about this" on a game opened from
 *   a card) there is one dialog only: the detail closes under it, the page
 *   underneath is the flow's background, and Close returns to the detail,
 *   with focus on the detail's Close button.
 * - **Ways out**: Close, Escape, the backdrop and the browser's Back go back
 *   one entry when compose was opened in the app (the origin's own entry), and
 *   otherwise replace the entry with `/`, never reaching an entry before the
 *   app's first. Focus returns to the + that opened it.
 * - **The guard**: a guest is sent to `/sign-in` with the `/compose` address
 *   as `from`, a profile-less account to `/create-profile`, with no dialog
 *   ever shown; loading, deactivated and unavailable show what `RequireAuth`
 *   shows, inside the dialog and never below the page.
 * - **The +** is on every page for an active account, absent otherwise; the
 *   Compose nav item is gone and nothing else in the nav changed; it stays
 *   outside the dialog, which is shown modally, so it leaves the tab order.
 * - **After a post** the dialog closes as Close does and the feed is read
 *   again; a failed post keeps the draft and the dialog.
 * - **Requests**: opening it reads nothing; publishing from the feed with two
 *   pages loaded is one POST /posts and two GET /feed, nothing else.
 * - **History state is read by `routes/modal-flow.tsx` alone.**
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
import { HttpResponse, http, type RequestHandler } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "../api/schema";
import { CirclePlusIcon } from "../components/ui/icons";
import { deactivatedShown } from "../test/account";
import {
  OWN_USER_ID,
  renderAppAt,
  renderAppWithHistory,
  type AppRender,
  type AppRouter,
  type Visitor,
} from "../test/app-route";
import { attachServer, summaryShown } from "../test/attach";
import { testProfile } from "../test/auth";
import {
  createPost,
  recordRequests,
  testPost,
  type RequestRecorder,
} from "../test/compose";
import { drawsIcon, textOf } from "../test/compose-modal";
import {
  feedPage,
  testAuthor,
  testPostView,
  type FeedPageBody,
  type PostView,
} from "../test/feed";
import { gameFinalPreview, postWithPreview } from "../test/previews";
import { cardUnderneath } from "../test/thread";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

const PLUS = "Compose a post";

const FIRST_TEXT = "Raptors in six";
const OLDER_TEXT = "Older take from page two";
const NEW_TEXT = "Fresh off the press";

const FIRST = testPostView({
  id: 101,
  text: FIRST_TEXT,
  author: testAuthor({ id: 11, username: "courtside11" }),
});
const OLDER = testPostView({
  id: 90,
  text: OLDER_TEXT,
  author: testAuthor({ id: 14, username: "older14" }),
  created_at: "2026-09-27T12:00:00Z",
});
const NEW = testPostView({
  id: 900,
  text: NEW_TEXT,
  author: testAuthor({ id: OWN_USER_ID, username: testProfile().username }),
  created_at: "2026-09-29T12:00:00Z",
});

let scrollTo: ReturnType<typeof vi.spyOn>;
let showModal: ReturnType<typeof vi.spyOn>;
let recorder: RequestRecorder | null = null;

beforeEach(() => {
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
});

afterEach(() => {
  scrollTo.mockRestore();
  showModal.mockRestore();
  recorder?.stop();
  recorder = null;
});

// ------------------------------------------------------------- the doubles

interface PagedFeed {
  handler: RequestHandler;
  /** `before_id` of every GET /feed, `null` for the first page. */
  readonly reads: (string | null)[];
  /** Put `post` at the top of the first page from now on. */
  publish(post: PostView): void;
}

/**
 * `GET /feed` answered by cursor: the first page (FIRST, then a cursor), and
 * page two (OLDER). A refetch of both pages reads both again.
 */
function pagedFeed(): PagedFeed {
  const reads: (string | null)[] = [];
  let top: PostView[] = [FIRST];
  return {
    handler: http.get("*/feed", ({ request }) => {
      const before = new URL(request.url).searchParams.get("before_id");
      reads.push(before);
      const body: FeedPageBody =
        before === null ? feedPage(top, 100) : feedPage([OLDER], null);
      return HttpResponse.json<FeedPageBody>(body);
    }),
    reads,
    publish(post: PostView): void {
      top = [post, ...top];
    },
  };
}

// ------------------------------------------------------------- the helpers

function composeDialog(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Compose" });
}

async function findComposeDialog(): Promise<HTMLElement> {
  const dialog = await screen.findByRole("dialog", { name: "Compose" });
  await within(dialog).findByRole("textbox", { name: /post/i });
  return dialog;
}

function openDialogs(): HTMLDialogElement[] {
  return [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")];
}

function expectOneDialog(): void {
  expect(openDialogs()).toHaveLength(1);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
}

function plus(): HTMLElement {
  return screen.getByRole("button", { name: PLUS });
}

function queryPlus(): HTMLElement | null {
  return screen.queryByRole("button", { name: PLUS });
}

function primaryNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

async function memberShown(): Promise<void> {
  await within(primaryNav()).findByRole("link", { name: "Your profile" });
}

function pressClose(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
): Promise<void> {
  return user.click(within(dialog).getByRole("button", { name: "Close" }));
}

function pressEscape(dialog: HTMLElement): void {
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
}

function pressBackdrop(dialog: HTMLElement): void {
  fireEvent.mouseDown(dialog);
  fireEvent.click(dialog);
}

async function browserBack(router: AppRouter): Promise<void> {
  await act(async () => {
    await router.navigate(-1);
  });
}

async function at(router: AppRouter, path: string): Promise<void> {
  await waitFor(() =>
    expect(
      `${router.state.location.pathname}${router.state.location.search}`,
    ).toBe(path),
  );
}

/** Every "Compose" heading on the page: the dialog's title, and only that. */
function composeHeadings(): HTMLElement[] {
  return screen.queryAllByRole("heading", { name: /^compose$/i });
}

/** Records every `<dialog>` that is ever added to the page, however briefly. */
function watchDialogs(): { seen: () => number; stop: () => void } {
  let seen = 0;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches("dialog") || node.querySelector("dialog") !== null)
          seen += 1;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    seen: () => {
      // Deliver what is queued before reading.
      for (const record of observer.takeRecords()) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches("dialog") || node.querySelector("dialog") !== null)
            seen += 1;
        }
      }
      return seen;
    },
    stop: () => observer.disconnect(),
  };
}

// ------------------------------------------------------- over the feed

/** The feed with both pages loaded, for a member. */
async function feedLoaded(
  extra: (feed: PagedFeed) => RequestHandler[] = () => [],
) {
  const user = userEvent.setup();
  const feed = pagedFeed();
  const app = renderAppAt("/", "member", [feed.handler, ...extra(feed)]);
  await screen.findByText(FIRST_TEXT);
  await user.click(screen.getByRole("button", { name: /load more/i }));
  await screen.findByText(OLDER_TEXT);
  await memberShown();
  return {
    user,
    app,
    feed,
    origin: { ...app.router.state.location },
    heading: screen.getByRole("heading", { level: 1, name: "Feed" }),
    first: cardUnderneath(FIRST_TEXT),
    older: cardUnderneath(OLDER_TEXT),
    feedReads: feed.reads.length,
  };
}

type Loaded = Awaited<ReturnType<typeof feedLoaded>>;

async function openFromFeed(): Promise<Loaded & { dialog: HTMLElement }> {
  const loaded = await feedLoaded();
  await loaded.user.click(plus());
  await at(loaded.app.router, "/compose");
  const dialog = await findComposeDialog();
  return { ...loaded, dialog };
}

/** Back on the feed's own entry, as it was left, focus on the +. */
async function expectFeedAsLeft(flow: Loaded): Promise<void> {
  const { app, origin } = flow;
  await waitFor(() => expect(composeDialog()).toBeNull());
  expect(openDialogs()).toEqual([]);
  expect(app.router.state.location.pathname).toBe("/");
  expect(app.router.state.location.key).toBe(origin.key);
  expect(app.router.state.historyAction).toBe("POP");
  expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
    flow.heading,
  );
  expect(cardUnderneath(FIRST_TEXT)).toBe(flow.first);
  expect(cardUnderneath(OLDER_TEXT)).toBe(flow.older);
  expect(flow.feed.reads).toHaveLength(flow.feedReads);
  expect(scrollTo).not.toHaveBeenCalled();
  await waitFor(() => expect(plus()).toHaveFocus());
}

describe("the + opens compose over the feed, which stays as it was", () => {
  it("opens a dialog titled Compose at /compose, the feed mounted underneath", async () => {
    const flow = await openFromFeed();

    expectOneDialog();
    expect(composeHeadings()).toHaveLength(1);
    expect(flow.dialog).toContainElement(composeHeadings()[0]);
    // Not re-mounted: the same nodes, both loaded pages, no second read.
    expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
      flow.heading,
    );
    expect(cardUnderneath(FIRST_TEXT)).toBe(flow.first);
    expect(cardUnderneath(OLDER_TEXT)).toBe(flow.older);
    expect(flow.feed.reads).toHaveLength(flow.feedReads);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("is the + outside the dialog, which is shown modally (so the + leaves the tab order)", async () => {
    const flow = await openFromFeed();

    expect(showModal).toHaveBeenCalled();
    const button = queryPlus();
    if (button !== null) {
      expect(flow.dialog).not.toContainElement(button);
    }
  });
});

describe("the ways out of a compose opened in the app", () => {
  it("Close returns to the feed's own entry", async () => {
    const flow = await openFromFeed();
    await pressClose(flow.user, flow.dialog);
    await expectFeedAsLeft(flow);
  });

  it("Escape returns to the feed's own entry", async () => {
    const flow = await openFromFeed();
    pressEscape(flow.dialog);
    await expectFeedAsLeft(flow);
  });

  it("a backdrop click returns to the feed's own entry", async () => {
    const flow = await openFromFeed();
    pressBackdrop(flow.dialog);
    await expectFeedAsLeft(flow);
  });

  it("the browser's Back returns to the feed's own entry", async () => {
    const flow = await openFromFeed();
    await browserBack(flow.app.router);
    await waitFor(() => expect(composeDialog()).toBeNull());
    expect(flow.app.router.state.location.key).toBe(flow.origin.key);
    expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
      flow.heading,
    );
    expect(cardUnderneath(OLDER_TEXT)).toBe(flow.older);
    expect(flow.feed.reads).toHaveLength(flow.feedReads);
  });

  it("makes no request to open or to close", async () => {
    const loaded = await feedLoaded();
    recorder = recordRequests();

    await loaded.user.click(plus());
    const dialog = await findComposeDialog();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recorder.paths(), "opening reads nothing").toEqual([]);

    await pressClose(loaded.user, dialog);
    await waitFor(() => expect(composeDialog()).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recorder.paths(), "closing reads nothing").toEqual([]);
  });
});

describe("over other pages", () => {
  const PAGES: {
    path: string;
    heading: RegExp;
    extra?: () => RequestHandler[];
  }[] = [
    {
      path: `/profile/${OWN_USER_ID}`,
      heading: new RegExp(`^${testProfile().username}$`),
    },
    { path: "/stats/seasons", heading: /^stats$/i },
    { path: "/search", heading: /^search$/i },
    {
      path: "/games/501",
      heading: /Toronto Raptors/,
      extra: () => attachServer().handlers,
    },
  ];

  it.each(PAGES)(
    "$path stays mounted under compose and is as it was after Close",
    async ({ path, heading, extra }) => {
      const user = userEvent.setup();
      const app = renderAppAt(path, "member", extra?.() ?? []);
      const h1 = await screen.findByRole("heading", {
        level: 1,
        name: heading,
      });
      await memberShown();
      const originKey = app.router.state.location.key;

      await user.click(plus());
      const dialog = await findComposeDialog();
      expectOneDialog();
      expect(app.router.state.location.pathname).toBe("/compose");
      expect(screen.getByRole("heading", { level: 1, name: heading })).toBe(h1);

      await pressClose(user, dialog);
      await waitFor(() => expect(composeDialog()).toBeNull());
      expect(app.router.state.location.key).toBe(originKey);
      expect(app.router.state.location.pathname).toBe(path);
      expect(screen.getByRole("heading", { level: 1, name: heading })).toBe(h1);
      await waitFor(() => expect(plus()).toHaveFocus());
    },
  );
});

describe("a direct load or a reload opens compose over the feed", () => {
  it.each([
    "/compose",
    "/compose?reply_to=42",
    "/compose?repost_of=7",
    "/compose?link=game_final&ref=501",
  ])("%s opens the dialog over the feed", async (path) => {
    renderAppAt(path, "member", [
      pagedFeed().handler,
      ...attachServer().handlers,
    ]);

    await findComposeDialog();
    expectOneDialog();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Feed" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(FIRST_TEXT)).toBeInTheDocument();
    if (path.includes("link=")) await summaryShown();
  });

  it.each(["Close", "Escape", "backdrop"] as const)(
    "%s replaces the entry with / and never reaches the entry before the app",
    async (how) => {
      const user = userEvent.setup();
      const app = renderAppWithHistory(
        { initialEntries: ["/unrelated", "/compose"], initialIndex: 1 },
        "member",
        [pagedFeed().handler],
      );
      const visited: string[] = [];
      const unsubscribe = app.router.subscribe((state) => {
        visited.push(state.location.pathname);
      });
      const dialog = await findComposeDialog();
      const feedHeading = await screen.findByRole("heading", {
        level: 1,
        name: "Feed",
      });

      if (how === "Close") await pressClose(user, dialog);
      else if (how === "Escape") pressEscape(dialog);
      else pressBackdrop(dialog);

      await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
      await waitFor(() => expect(composeDialog()).toBeNull());
      expect(app.router.state.historyAction).toBe("REPLACE");
      expect(visited).not.toContain("/unrelated");
      // The feed underneath was already the feed: not re-mounted either.
      expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
        feedHeading,
      );
      unsubscribe();
    },
  );
});

describe("from inside the detail modal: one dialog, and Close returns to the detail", () => {
  const GAME_POST = postWithPreview(gameFinalPreview(), {
    id: 101,
    text: FIRST_TEXT,
    author: testAuthor({ id: 11, username: "courtside11" }),
  });

  async function gameDetailFromFeed() {
    const user = userEvent.setup();
    const feed = http.get("*/feed", () =>
      HttpResponse.json<FeedPageBody>(feedPage([GAME_POST], null)),
    );
    const app = renderAppAt("/", "member", [feed, ...attachServer().handlers]);
    await screen.findByText(FIRST_TEXT);
    await memberShown();
    const feedHeading = screen.getByRole("heading", { level: 1, name: "Feed" });
    const card = cardUnderneath(FIRST_TEXT);
    const gameLink = [
      ...card.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ].find((link) => link.getAttribute("href") === "/games/501");
    if (gameLink === undefined) throw new Error("no game link on the card");

    await user.click(gameLink);
    await at(app.router, "/games/501");
    await screen.findByRole("dialog", { name: "Game" });
    const detailKey = app.router.state.location.key;
    return { user, app, feedHeading, detailKey };
  }

  async function gameResultLink(detail: HTMLElement): Promise<HTMLElement> {
    const links = await within(detail).findAllByRole("link", {
      name: /post about/i,
    });
    const link = links.find((candidate) =>
      (candidate.getAttribute("href") ?? "").includes("link=game_final"),
    );
    if (link === undefined)
      throw new Error("no game-result link in the detail");
    return link;
  }

  it("opens compose in place of the detail, over the flow's background", async () => {
    const { user, app, feedHeading } = await gameDetailFromFeed();
    const detail = screen.getByRole("dialog", { name: "Game" });

    await user.click(await gameResultLink(detail));

    await at(app.router, "/compose?link=game_final&ref=501");
    await findComposeDialog();
    await summaryShown();
    expectOneDialog();
    expect(screen.queryByRole("dialog", { name: "Game" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
      feedHeading,
    );
  });

  it("Close returns to the game detail, with focus on its Close button", async () => {
    const { user, app, detailKey } = await gameDetailFromFeed();
    const detail = screen.getByRole("dialog", { name: "Game" });
    await user.click(await gameResultLink(detail));
    const dialog = await findComposeDialog();

    await pressClose(user, dialog);

    await at(app.router, "/games/501");
    expect(app.router.state.location.key).toBe(detailKey);
    const back = await screen.findByRole("dialog", { name: "Game" });
    expectOneDialog();
    await waitFor(() =>
      expect(within(back).getByRole("button", { name: "Close" })).toHaveFocus(),
    );
  });

  it("opening it from the detail reads only the link's summary", async () => {
    const { user } = await gameDetailFromFeed();
    const detail = screen.getByRole("dialog", { name: "Game" });
    const link = await gameResultLink(detail);
    recorder = recordRequests();

    await user.click(link);
    await findComposeDialog();
    await summaryShown();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The recorder sees the client's `/api` base (VITE_API_BASE_URL).
    expect(recorder.paths()).toEqual(["/api/events/games/501"]);
  });
});

describe("the guard, before any dialog", () => {
  it.each([
    "/compose",
    "/compose?link=game_final&ref=501",
    "/compose?reply_to=42",
  ])(
    "a guest loading %s goes to sign-in with it as `from`, no dialog shown",
    async (path) => {
      const watch = watchDialogs();
      const app = renderAppAt(path, "anonymous", [pagedFeed().handler]);

      await waitFor(() =>
        expect(app.router.state.location.pathname).toBe("/sign-in"),
      );
      await screen.findByRole("heading", { name: /^sign\s*-?\s*in$/i });
      const state = app.router.state.location.state as {
        from?: { pathname?: string; search?: string };
      } | null;
      const url = new URL(path, "http://fanwire.test");
      expect(state?.from?.pathname).toBe(url.pathname);
      expect(state?.from?.search ?? "").toBe(url.search);
      expect(watch.seen(), "no dialog was ever shown").toBe(0);
      watch.stop();
    },
  );

  it("a profile-less account goes to /create-profile, no dialog shown", async () => {
    const watch = watchDialogs();
    const app = renderAppAt("/compose", "newcomer", [pagedFeed().handler]);

    await screen.findByRole("heading", { name: /^create your profile$/i });
    expect(app.router.state.location.pathname).toBe("/create-profile");
    expect(watch.seen(), "no dialog was ever shown").toBe(0);
    watch.stop();
  });

  it("a deactivated account sees the recovery screen inside the dialog, not below the page", async () => {
    renderAppAt("/compose", "deactivated", [pagedFeed().handler]);
    await deactivatedShown();

    const dialog = await screen.findByRole("dialog", { name: "Compose" });
    expect(
      await within(dialog).findByRole("heading", { name: /deactivated/i }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: /post/i })).toBeNull();
    const outside = screen
      .queryAllByRole("heading", { name: /deactivated/i })
      .filter((heading) => !dialog.contains(heading));
    expect(outside).toEqual([]);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Feed" }),
    ).toBeInTheDocument();
  });

  it("while the profile is loading, the loading line is inside the dialog", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app: AppRender = renderAppAt("/compose", "member", [
      pagedFeed().handler,
      http.get("*/users/me", async () => {
        await held;
        return HttpResponse.json(testProfile());
      }),
    ]);

    const dialog = await screen.findByRole("dialog", { name: "Compose" });
    await waitFor(() =>
      expect(
        within(dialog)
          .queryAllByRole("status")
          .map(textOf)
          .some((text) =>
            /loading your profile|checking your session/i.test(text),
          ),
      ).toBe(true),
    );
    const outside = screen
      .queryAllByRole("status")
      .filter((status) => !dialog.contains(status))
      .map(textOf)
      .filter((text) =>
        /loading your profile|checking your session/i.test(text),
      );
    expect(outside).toEqual([]);

    release();
    await findComposeDialog();
    expect(app.router.state.location.pathname).toBe("/compose");
  });

  it("an unavailable account sees the guard's alert inside the dialog", async () => {
    renderAppAt("/compose", "member", [
      pagedFeed().handler,
      http.get("*/users/me", () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
    ]);

    const dialog = await screen.findByRole("dialog", { name: "Compose" });
    const alert = await within(dialog).findByRole("alert");
    expect(textOf(alert)).toMatch(/could not check your profile/i);
    const outside = screen
      .queryAllByRole("alert")
      .filter((element) => !dialog.contains(element))
      .map(textOf)
      .filter((text) => /could not check your profile/i.test(text));
    expect(outside).toEqual([]);
  });
});

describe("the + button", () => {
  it.each([
    "/",
    "/search",
    "/stats/seasons",
    "/notifications",
    `/profile/${OWN_USER_ID}`,
    "/profile/42",
    "/no-such-page-exists",
  ])(
    "is on %s for an active account: a CirclePlusIcon button, not a link",
    async (path) => {
      renderAppAt(path, "member", [pagedFeed().handler]);
      await memberShown();

      const button = await screen.findByRole("button", { name: PLUS });
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(drawsIcon(button, CirclePlusIcon)).toBe(true);
      expect(screen.queryByRole("link", { name: PLUS })).toBeNull();
    },
  );

  it.each<[Visitor, string]>([
    ["anonymous", "/"],
    ["anonymous", "/search"],
    ["deactivated", "/"],
  ])("is absent for a %s visitor at %s", async (as, path) => {
    renderAppAt(path, as, [pagedFeed().handler]);
    if (as === "anonymous") {
      await screen.findByRole("link", { name: /^sign in$/i });
    } else {
      await deactivatedShown();
    }
    await screen.findByRole("heading", { level: 1 });

    expect(queryPlus()).toBeNull();
  });

  it("is absent for a profile-less account", async () => {
    renderAppAt("/create-profile", "newcomer", [pagedFeed().handler]);
    await screen.findByRole("heading", { name: /^create your profile$/i });

    expect(queryPlus()).toBeNull();
  });

  it("replaces the Compose nav item, and nothing else in the nav changes", async () => {
    renderAppAt("/", "member", [pagedFeed().handler]);
    await memberShown();

    const names = within(primaryNav())
      .getAllByRole("link")
      .map((link) => textOf(link));
    expect(names).toEqual([
      "Feed",
      "Notifications",
      "Search",
      "Stats",
      "Your profile",
    ]);
    expect(
      within(primaryNav()).queryByRole("link", { name: /compose/i }),
    ).toBeNull();
    expect(primaryNav()).not.toContainElement(plus());
  });
});

describe("after a post", () => {
  it("closes as Close does, and the feed shows the new post: 1 POST /posts and 2 GET /feed, nothing else", async () => {
    const bodies: CreatePostRequest[] = [];
    const loaded = await feedLoaded((feed) => [
      createPost({
        post: testPost({ id: 900, text: NEW_TEXT }),
        onRequest: (body) => {
          bodies.push(body);
          // The server has the post once it is created.
          feed.publish(NEW);
        },
      }),
    ]);
    const { user, app } = loaded;
    await user.click(plus());
    const dialog = await findComposeDialog();
    recorder = recordRequests();

    await user.type(
      within(dialog).getByRole("textbox", { name: /post/i }),
      NEW_TEXT,
    );
    await user.click(within(dialog).getByRole("button", { name: /^post$/i }));

    await waitFor(() => expect(composeDialog()).toBeNull());
    expect(app.router.state.location.pathname).toBe("/");
    expect(app.router.state.location.key).toBe(loaded.origin.key);
    await waitFor(() => expect(cardUnderneath(NEW_TEXT)).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The recorder sees the client's `/api` base. The new card's controls
    // read the shared profile query; the test client's staleTime is 0, so it
    // refetches here, where the app's (30 s, App.tsx) would not: not one of
    // compose's requests, so it is left out of the count.
    const calls = recorder.calls
      .map((call) => `${call.method} ${call.pathname.replace(/^\/api/, "")}`)
      .filter((call) => call !== "GET /users/me");
    expect(calls.filter((call) => call === "POST /posts")).toHaveLength(1);
    expect(calls.filter((call) => call === "GET /feed")).toHaveLength(2);
    expect(calls).toHaveLength(3);
    await waitFor(() => expect(plus()).toHaveFocus());
  });

  it("a failed post keeps the draft and the dialog open", async () => {
    const loaded = await feedLoaded(() => [createPost({ status: 500 })]);
    await loaded.user.click(plus());
    const dialog = await findComposeDialog();
    const box = within(dialog).getByRole("textbox", { name: /post/i });

    await loaded.user.type(box, "Not lost");
    await loaded.user.click(
      within(dialog).getByRole("button", { name: /^post$/i }),
    );

    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(composeDialog()).toBe(dialog);
    expect(box).toHaveValue("Not lost");
    expect(loaded.app.router.state.location.pathname).toBe("/compose");
  });
});

describe("history state is read by routes/modal-flow.tsx alone", () => {
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
      if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
        found.push(full);
    }
    return found;
  }

  const READS_STATE = [
    /\blocation\.state\b/,
    /useLocation\(\)\.state\b/,
    /\bstate\s+as\b/,
    /\{[^}]*\bstate\b[^}]*\}\s*=\s*useLocation\(\)/,
  ];

  it("no file under routes/ (but modal-flow.tsx), compose, games or players reads it", () => {
    const src = findSrcDir();
    const files = [
      ...sourceFiles(join(src, "routes")).filter(
        (file) => !file.endsWith(`${sep}modal-flow.tsx`),
      ),
      ...["compose", "games", "players"].flatMap((feature) =>
        sourceFiles(join(src, "features", feature)),
      ),
    ];
    expect(files.length).toBeGreaterThan(10);

    const offenders = files
      .filter((file) =>
        READS_STATE.some((pattern) => pattern.test(readFileSync(file, "utf8"))),
      )
      .map((file) => relative(src, file).split(sep).join("/"));

    expect(offenders).toEqual([]);
  });
});
