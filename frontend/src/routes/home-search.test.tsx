/**
 * FRONTEND-007 acceptance criterion 8, as FRONTEND-036 changed it: the
 * free-text bar renders on the search route, and the home page's own entry to
 * the same results view is the right rail's bar, from 76em only. Through the
 * real route table, the way `App` mounts it.
 *
 * FRONTEND-036 removed the bar above the feed, at every width, on purpose:
 * this file pinned it there until then. With no `matchMedia` (jsdom, and so
 * the narrow layout) `/` is the feed alone: no search box and no `search`
 * landmark, and the feed's `h1` "Feed" stays the page's only `h1`, with no
 * second `main`, `banner` or Primary `nav` (`layout.md` §1). From 76em the
 * rail's bar searches on `/` itself (`/?q=`), and its Show all reaches the
 * same `/search?q=` view; the rail itself is `home-rail.test.tsx`'s.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { renderAppAt, type Visitor } from "../test/app-route";
import { testPostView } from "../test/feed";
import {
  accountsPage,
  accountsStub,
  postsPage,
  postsStub,
  stubViewport,
  testAccount,
  type ViewportStub,
} from "../test/search";
import { server } from "../test/server";

const BOX_NAME = "Search accounts and posts";
const ACCOUNT = testAccount({ id: 41, username: "baseline41" });
const POST = testPostView({ id: 301, text: "Raptors from the baseline" });

let viewport: ViewportStub | null = null;

afterEach(() => {
  viewport?.restore();
  viewport = null;
});

function arrangeResults() {
  const accounts = accountsStub({ 0: accountsPage([ACCOUNT], null) });
  const posts = postsStub({ 0: postsPage([POST], null) });
  server.use(accounts.handler, posts.handler);
  return { accounts, posts };
}

/** Banners outside `main` and sectioning content: the page's own, not a post's header. */
function pageBanners(): HTMLElement[] {
  return screen
    .getAllByRole("banner")
    .filter(
      (element) =>
        element.parentElement?.closest("main, article, aside, nav, section") ==
        null,
    );
}

/** What says the results view for `q` is on screen, whichever way it was reached. */
async function expectResultsFor(q: string): Promise<void> {
  expect(
    await screen.findByRole("heading", { level: 1, name: "Search" }),
  ).toBeInTheDocument();
  const accounts = await screen.findByRole("region", { name: "Accounts" });
  expect(
    await within(accounts).findByRole("link", { name: ACCOUNT.username }),
  ).toHaveAttribute("href", `/profile/${ACCOUNT.id}`);
  const posts = screen.getByRole("region", { name: "Posts" });
  const article = await within(posts).findByRole("article");
  expect(article).toHaveTextContent(POST.text ?? "");
  expect(screen.getByRole("searchbox", { name: BOX_NAME })).toHaveValue(q);
  expect(screen.queryByRole("heading", { level: 1, name: "Feed" })).toBeNull();
}

describe("the home page has no search bar above the feed", () => {
  it.each<Visitor>(["anonymous", "member"])("for a %s visitor", async (as) => {
    renderAppAt("/", as);

    const feedHeading = await screen.findByRole("heading", {
      level: 1,
      name: "Feed",
    });

    expect(screen.queryByRole("searchbox", { name: BOX_NAME })).toBeNull();
    expect(screen.queryAllByRole("search")).toEqual([]);
    expect(screen.getAllByRole("heading", { level: 1 })).toEqual([feedHeading]);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(pageBanners()).toHaveLength(1);
    expect(screen.getAllByRole("navigation", { name: "Primary" })).toHaveLength(
      1,
    );
  });
});

describe("both entry points reach the same results view", () => {
  it("from the home page's rail (from 76em): a search stays on /, and Show all lands on the Search view's results", async () => {
    const user = userEvent.setup();
    viewport = stubViewport(1280);
    const { accounts, posts } = arrangeResults();
    const { router } = renderAppAt("/", "anonymous");

    await screen.findByRole("heading", { level: 1, name: "Feed" });
    const rail = screen.getByRole("complementary");
    await user.type(
      within(rail).getByRole("searchbox", { name: BOX_NAME }),
      "  raptors  ",
    );
    await user.click(within(rail).getByRole("button", { name: "Search" }));

    expect(router.state.location.pathname).toBe("/");
    expect(router.state.location.search).toBe("?q=raptors");
    const showAll = await within(rail).findAllByRole("link", {
      name: /show all/i,
    });
    await user.click(showAll[0]);

    await expectResultsFor("raptors");
    // The rail's first page is the Search view's cache; a background refetch
    // of it may follow, but every request is for the one query.
    for (const stub of [accounts, posts]) {
      const asked = stub.requests.map((params) => params.get("q"));
      expect(asked.length).toBeGreaterThan(0);
      expect(new Set(asked)).toEqual(new Set(["raptors"]));
    }
  });

  it.each<Visitor>(["anonymous", "member"])(
    "from /search?q= directly, for a %s visitor, with the box prefilled",
    async (as) => {
      arrangeResults();
      renderAppAt("/search?q=raptors", as);

      await expectResultsFor("raptors");
      expect(screen.getAllByRole("searchbox", { name: BOX_NAME })).toHaveLength(
        1,
      );
    },
  );

  it("from the bar on /search: a new query replaces the results", async () => {
    const user = userEvent.setup();
    const { accounts } = arrangeResults();
    renderAppAt("/search?q=raptors", "anonymous");
    await expectResultsFor("raptors");

    const box = screen.getByRole("searchbox", { name: BOX_NAME });
    await user.clear(box);
    await user.type(box, "suns{Enter}");

    expect(
      await screen.findByRole("searchbox", { name: BOX_NAME }),
    ).toHaveValue("suns");
    await within(
      await screen.findByRole("region", { name: "Accounts" }),
    ).findByRole("link", {
      name: ACCOUNT.username,
    });
    expect(accounts.requests.map((params) => params.get("q"))).toContain(
      "suns",
    );
  });

  it("the search route renders the bar even without a query", async () => {
    renderAppAt("/search", "anonymous");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Search" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: BOX_NAME })).toHaveValue("");
    // FRONTEND-009: the sports-data filter has moved to the Stats page.
    expect(screen.queryByRole("region", { name: "Games" })).toBeNull();
  });
});
