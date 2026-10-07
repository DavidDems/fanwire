/**
 * FRONTEND-007 — the free-text results view: acceptance criteria 1, 2, 3, the
 * free-text half of 7, and the shared-component half of 9.
 *
 * **Two calls, two paginations.** `GET /search/accounts` and
 * `GET /search/posts` are independent ([[0x07-search]] Resolved decisions:
 * "accounts first" is purely a rendering order). Each list pages on its own
 * `next_offset`, and the bug this is written against — two lists sharing one
 * offset, or one query — only shows once the two result sets have different
 * lengths. So the fixtures always give one list a next page and the other
 * none, both ways round, and the tests count requests *per endpoint*.
 *
 * **Post results are the feed's `PostNode`.** Behaviourally, that is: each
 * result is an `article` carrying PostNode's own controls. And one property a
 * look-alike renderer cannot fake: a like on a post result moves its count
 * optimistically, which `LikeButton` only does for posts cached under the
 * feed's own key root. The key itself is not asserted — only what a reader
 * sees while the like is still in flight.
 *
 * Paging is an explicit control, as on the feed (jsdom has no
 * `IntersectionObserver`). Each load-more is the shared `Button`'s secondary
 * variant, asserted through the module's own export (`verification.md` §2c),
 * and `search-css.test.ts` checks the rule is on disk.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { AuthService } from "../../auth/AuthService";
import buttonStyles from "../../components/ui/Button.module.css";
import {
  FakeAuthService,
  profileFound,
  renderWithAuth,
  teamsAre,
  testSession,
} from "../../test/auth";
import { likeStub, testAuthor, testPostView } from "../../test/feed";
import {
  accountsPage,
  accountsStub,
  gameFiltersAre,
  gamesStub,
  offsetOf,
  postsPage,
  postsStub,
  testAccount,
  type AccountsPageBody,
  type PostsPageBody,
} from "../../test/search";
import { server } from "../../test/server";
import { SearchPage } from "./SearchPage";

const Q = "raptors";

const ALICE = testAccount({
  id: 31,
  username: "alice31",
  description: "Courtside since 2019",
});
const BOB = testAccount({ id: 32, username: "bob32", description: null });
const CAROL = testAccount({ id: 33, username: "carol33", description: null });
const DAVE = testAccount({ id: 34, username: "dave34", description: null });

const POST_A = testPostView({ id: 201, text: "Raptors in six, again" });
const POST_B = testPostView({
  id: 202,
  text: "The Raptors bench is deep",
  author: testAuthor({ id: 12, username: "courtside12" }),
});
const POST_C = testPostView({ id: 203, text: "Raptors defence travels" });

function renderSearch(
  path: string,
  stubs: {
    accounts?: Record<number, AccountsPageBody>;
    posts?: Record<number, PostsPageBody>;
  } = {},
  authService: AuthService = new FakeAuthService(),
) {
  const accounts = accountsStub(
    stubs.accounts ?? { 0: accountsPage([ALICE, BOB], null) },
  );
  const posts = postsStub(stubs.posts ?? { 0: postsPage([POST_A], null) });
  const games = gamesStub();
  server.use(
    accounts.handler,
    posts.handler,
    games.handler,
    gameFiltersAre(),
    teamsAre(),
  );
  renderWithAuth(
    <Routes>
      <Route path="/search" element={<SearchPage />} />
      <Route path="/profile/:userId" element={<p>profile stub</p>} />
    </Routes>,
    { route: path, authService },
  );
  return { accounts, posts, games };
}

function accountsRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Accounts" });
}

function postsRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Posts" });
}

function precedes(first: Node, second: Node): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function postCard(text: string): HTMLElement {
  const card = within(postsRegion())
    .getAllByRole("article")
    .find((article) => article.textContent?.includes(text));
  if (card === undefined)
    throw new Error(`no post result containing ${JSON.stringify(text)}`);
  return card;
}

describe("the search view", () => {
  it("is headed Search", async () => {
    renderSearch(`/search?q=${Q}`);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Search" }),
    ).toBeInTheDocument();
  });

  it("without a query shows the bar and the Games filter, and fetches no accounts or posts", async () => {
    const { accounts, posts } = renderSearch("/search");

    await screen.findByRole("region", { name: "Games" });
    expect(
      screen.getByRole("searchbox", { name: "Search accounts and posts" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Accounts" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Posts" })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(accounts.requests).toHaveLength(0);
    expect(posts.requests).toHaveLength(0);
  });

  it("prefills the bar with q", async () => {
    renderSearch(`/search?q=${Q}`);

    expect(
      await screen.findByRole("searchbox", {
        name: "Search accounts and posts",
      }),
    ).toHaveValue(Q);
  });
});

describe("free-text results (criterion 1)", () => {
  it("calls GET /search/accounts and GET /search/posts once each, with the same q, from offset 0", async () => {
    const { accounts, posts } = renderSearch(`/search?q=${Q}`);

    await within(
      await screen.findByRole("region", { name: "Accounts" }),
    ).findByRole("link", {
      name: ALICE.username,
    });
    await within(postsRegion()).findByRole("article");

    expect(accounts.requests).toHaveLength(1);
    expect(posts.requests).toHaveLength(1);
    expect(accounts.requests[0].get("q")).toBe(Q);
    expect(posts.requests[0].get("q")).toBe(Q);
    expect(offsetOf(accounts.requests[0])).toBe(0);
    expect(offsetOf(posts.requests[0])).toBe(0);
  });

  it("renders the bar, then accounts above posts, then the Games filter", async () => {
    renderSearch(`/search?q=${Q}`);

    const accounts = await screen.findByRole("region", { name: "Accounts" });
    const posts = screen.getByRole("region", { name: "Posts" });
    const games = screen.getByRole("region", { name: "Games" });
    const bar = screen.getByRole("search");

    expect(
      within(accounts).getByRole("heading", { level: 2, name: "Accounts" }),
    ).toBeVisible();
    expect(
      within(posts).getByRole("heading", { level: 2, name: "Posts" }),
    ).toBeVisible();
    expect(precedes(bar, accounts), "the bar comes before the accounts").toBe(
      true,
    );
    expect(precedes(accounts, posts), "accounts are rendered above posts").toBe(
      true,
    );
    expect(posts.contains(accounts)).toBe(false);
    expect(
      precedes(posts, games),
      "the Games filter comes after the posts",
    ).toBe(true);
  });

  it("lists each account linking to its profile by username, with its description when it has one", async () => {
    renderSearch(`/search?q=${Q}`);

    const region = await screen.findByRole("region", { name: "Accounts" });
    await within(region).findByRole("link", { name: ALICE.username });

    expect(within(region).getByRole("list")).toBeInTheDocument();
    const items = within(region).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(
      within(items[0]).getByRole("link", { name: ALICE.username }),
    ).toHaveAttribute("href", `/profile/${ALICE.id}`);
    expect(
      within(items[0]).getByText(ALICE.description ?? ""),
    ).toBeInTheDocument();
    expect(
      within(items[1]).getByRole("link", { name: BOB.username }),
    ).toHaveAttribute("href", `/profile/${BOB.id}`);
    expect(items[1].textContent).not.toMatch(/null/);
  });
});

describe("post results render through the feed's PostNode (criterion 3)", () => {
  it("renders each post as an article with PostNode's own controls", async () => {
    renderSearch(`/search?q=${Q}`, {
      posts: { 0: postsPage([POST_A, POST_B], null) },
    });

    await within(
      await screen.findByRole("region", { name: "Posts" }),
    ).findAllByRole("article");
    for (const post of [POST_A, POST_B]) {
      const card = postCard(post.text ?? "");
      expect(
        within(card).getByRole("link", { name: post.author.username }),
      ).toHaveAttribute("href", `/profile/${post.author.id}`);
      expect(
        within(card).getByRole("button", { name: /^like$/i }),
      ).toBeInTheDocument();
      expect(
        within(card).getByText(`${post.like_count} likes`),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("button", { name: "Show replies" }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(
        within(card).getByRole("link", { name: /reply/i }),
      ).toHaveAttribute("href", `/compose?reply_to=${post.id}`);
    }
  });

  it("moves a post result's like count up before the like returns, as the feed does", async () => {
    const user = userEvent.setup();
    const like = likeStub();
    server.use(...like.handlers, profileFound());
    const { posts } = renderSearch(
      `/search?q=${Q}`,
      {},
      new FakeAuthService({ session: testSession() }),
    );

    await within(
      await screen.findByRole("region", { name: "Posts" }),
    ).findByText("3 likes");
    // The server's own view once the like lands, so a refetch after it agrees.
    posts.setPage(
      0,
      postsPage([{ ...POST_A, like_count: 4, liked_by_viewer: true }], null),
    );
    const release = like.hold();

    await user.click(
      within(postCard(POST_A.text ?? "")).getByRole("button", {
        name: /^like$/i,
      }),
    );

    expect(
      await within(postCard(POST_A.text ?? "")).findByRole("button", {
        name: /^unlike$/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(postCard(POST_A.text ?? "")).getByText("4 likes"),
    ).toBeInTheDocument();
    expect(like.calls).toEqual([{ method: "POST", postId: POST_A.id }]);

    release();
    await waitFor(() => {
      expect(
        within(postsRegion()).getByRole("button", { name: /^unlike$/i }),
      ).toBeInTheDocument();
    });
  });
});

describe("each list pages on its own next_offset (criterion 2)", () => {
  it("loads more accounts at offset=next_offset and appends, without refetching posts", async () => {
    const user = userEvent.setup();
    const { accounts, posts } = renderSearch(`/search?q=${Q}`, {
      accounts: {
        0: accountsPage([ALICE, BOB, CAROL], 20),
        20: accountsPage([DAVE], null),
      },
      posts: { 0: postsPage([POST_A], null) },
    });

    const region = await screen.findByRole("region", { name: "Accounts" });
    const more = await within(region).findByRole("button", {
      name: "Load more accounts",
    });
    await within(postsRegion()).findByRole("article");
    expect(more).toHaveClass(buttonStyles.secondary);
    expect(
      within(postsRegion()).queryByRole("button", { name: "Load more posts" }),
    ).toBeNull();

    await user.click(more);

    await within(region).findByRole("link", { name: DAVE.username });
    expect(within(region).getAllByRole("listitem")).toHaveLength(4);
    expect(accounts.requests).toHaveLength(2);
    expect(offsetOf(accounts.requests[1])).toBe(20);
    expect(accounts.requests[1].get("q")).toBe(Q);
    expect(
      posts.requests,
      "loading more accounts must not refetch posts",
    ).toHaveLength(1);
    expect(
      within(region).queryByRole("button", { name: "Load more accounts" }),
    ).toBeNull();
    expect(within(postsRegion()).getAllByRole("article")).toHaveLength(1);
  });

  it("loads more posts at offset=next_offset and appends, without refetching accounts", async () => {
    const user = userEvent.setup();
    const { accounts, posts } = renderSearch(`/search?q=${Q}`, {
      accounts: { 0: accountsPage([ALICE], null) },
      posts: {
        0: postsPage([POST_A, POST_B], 20),
        20: postsPage([POST_C], null),
      },
    });

    const region = await screen.findByRole("region", { name: "Posts" });
    const more = await within(region).findByRole("button", {
      name: "Load more posts",
    });
    await within(accountsRegion()).findByRole("link", { name: ALICE.username });
    expect(more).toHaveClass(buttonStyles.secondary);
    expect(
      within(accountsRegion()).queryByRole("button", {
        name: "Load more accounts",
      }),
    ).toBeNull();

    await user.click(more);

    await waitFor(() => {
      expect(within(region).getAllByRole("article")).toHaveLength(3);
    });
    expect(postCard(POST_C.text ?? "")).toBeInTheDocument();
    expect(posts.requests).toHaveLength(2);
    expect(offsetOf(posts.requests[1])).toBe(20);
    expect(posts.requests[1].get("q")).toBe(Q);
    expect(
      accounts.requests,
      "loading more posts must not refetch accounts",
    ).toHaveLength(1);
    expect(
      within(region).queryByRole("button", { name: "Load more posts" }),
    ).toBeNull();
    expect(within(accountsRegion()).getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("states", () => {
  const NOTHING = "zebrafish";

  it("says no accounts matched, naming the query, in the Accounts section", async () => {
    renderSearch(`/search?q=${NOTHING}`, {
      accounts: { 0: accountsPage([], null) },
      posts: { 0: postsPage([POST_A], null) },
    });

    const region = await screen.findByRole("region", { name: "Accounts" });
    await waitFor(() => expect(region.textContent).toContain(NOTHING));
    expect(within(region).queryAllByRole("listitem")).toHaveLength(0);
    // The other section is unaffected.
    expect(
      await within(postsRegion()).findByRole("article"),
    ).toBeInTheDocument();
  });

  it("says no posts matched, naming the query, in the Posts section", async () => {
    renderSearch(`/search?q=${NOTHING}`, {
      accounts: { 0: accountsPage([ALICE], null) },
      posts: { 0: postsPage([], null) },
    });

    const region = await screen.findByRole("region", { name: "Posts" });
    await waitFor(() => expect(region.textContent).toContain(NOTHING));
    expect(within(region).queryAllByRole("article")).toHaveLength(0);
    expect(
      await within(accountsRegion()).findByRole("link", {
        name: ALICE.username,
      }),
    ).toBeInTheDocument();
  });

  it("shows a status line in each section while it loads", async () => {
    const accounts = accountsStub({ 0: accountsPage([ALICE], null) });
    const posts = postsStub({ 0: postsPage([POST_A], null) });
    const releaseAccounts = accounts.hold();
    const releasePosts = posts.hold();
    server.use(accounts.handler, posts.handler, gameFiltersAre(), teamsAre());
    renderWithAuth(
      <Routes>
        <Route path="/search" element={<SearchPage />} />
      </Routes>,
      { route: `/search?q=${Q}` },
    );

    const accountsSection = await screen.findByRole("region", {
      name: "Accounts",
    });
    expect(
      await within(accountsSection).findByRole("status"),
    ).toBeInTheDocument();
    expect(
      await within(postsRegion()).findByRole("status"),
    ).toBeInTheDocument();

    releaseAccounts();
    releasePosts();
    await within(accountsSection).findByRole("link", { name: ALICE.username });
    await within(postsRegion()).findByRole("article");
  });

  it("shows an alert in Accounts when that search fails, and still shows the posts", async () => {
    const accounts = accountsStub();
    accounts.fail();
    const posts = postsStub({ 0: postsPage([POST_A], null) });
    server.use(accounts.handler, posts.handler, gameFiltersAre(), teamsAre());
    renderWithAuth(
      <Routes>
        <Route path="/search" element={<SearchPage />} />
      </Routes>,
      { route: `/search?q=${Q}` },
    );

    const region = await screen.findByRole("region", { name: "Accounts" });
    expect(await within(region).findByRole("alert")).toBeInTheDocument();
    expect(
      await within(postsRegion()).findByRole("article"),
    ).toBeInTheDocument();
    expect(within(postsRegion()).queryByRole("alert")).toBeNull();
  });

  it("shows an alert in Posts when that search fails, and still shows the accounts", async () => {
    const accounts = accountsStub({ 0: accountsPage([ALICE], null) });
    const posts = postsStub();
    posts.fail();
    server.use(accounts.handler, posts.handler, gameFiltersAre(), teamsAre());
    renderWithAuth(
      <Routes>
        <Route path="/search" element={<SearchPage />} />
      </Routes>,
      { route: `/search?q=${Q}` },
    );

    const region = await screen.findByRole("region", { name: "Posts" });
    expect(await within(region).findByRole("alert")).toBeInTheDocument();
    expect(
      await within(accountsRegion()).findByRole("link", {
        name: ALICE.username,
      }),
    ).toBeInTheDocument();
    expect(within(accountsRegion()).queryByRole("alert")).toBeNull();
  });
});
