/**
 * FRONTEND-007 acceptance criterion 8 — the free-text bar renders on both the
 * home page and the search route, and both entry points reach the same results
 * view. Through the real route table, the way `App` mounts it.
 *
 * The home page is the feed with the bar above it. `features/feed/**` is
 * forbidden to this unit, so the bar is added by the route table's index
 * element, not by the feed — and the feed's `h1` "Feed" stays the page's only
 * `h1`, with no second `main`, `banner` or Primary `nav` (`layout.md` §1).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt, type Visitor } from "../test/app-route";
import { testPostView } from "../test/feed";
import {
  accountsPage,
  accountsStub,
  postsPage,
  postsStub,
  testAccount,
} from "../test/search";
import { server } from "../test/server";

const BOX_NAME = "Search accounts and posts";
const ACCOUNT = testAccount({ id: 41, username: "baseline41" });
const POST = testPostView({ id: 301, text: "Raptors from the baseline" });

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

describe("the home page carries the search bar above the feed", () => {
  it.each<Visitor>(["anonymous", "member"])("for a %s visitor", async (as) => {
    renderAppAt("/", as);

    const feedHeading = await screen.findByRole("heading", {
      level: 1,
      name: "Feed",
    });
    const box = screen.getByRole("searchbox", { name: BOX_NAME });
    const main = screen.getByRole("main");

    expect(main).toContainElement(box);
    expect(
      Boolean(
        box.compareDocumentPosition(feedHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      "the bar sits above the feed",
    ).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 })).toEqual([feedHeading]);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(pageBanners()).toHaveLength(1);
    expect(screen.getAllByRole("navigation", { name: "Primary" })).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("search")).toHaveLength(1);
  });
});

describe("both entry points reach the same results view", () => {
  it("from the home page: typing a query and submitting lands on the Search view's results", async () => {
    const user = userEvent.setup();
    const { accounts, posts } = arrangeResults();
    renderAppAt("/", "anonymous");

    await screen.findByRole("heading", { level: 1, name: "Feed" });
    await user.type(
      screen.getByRole("searchbox", { name: BOX_NAME }),
      "  raptors  ",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    await expectResultsFor("raptors");
    expect(accounts.requests.map((params) => params.get("q"))).toEqual([
      "raptors",
    ]);
    expect(posts.requests.map((params) => params.get("q"))).toEqual([
      "raptors",
    ]);
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
    expect(
      await screen.findByRole("region", { name: "Games" }),
    ).toBeInTheDocument();
  });
});
