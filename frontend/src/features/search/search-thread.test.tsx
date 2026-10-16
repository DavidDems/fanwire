/**
 * FRONTEND-010 criterion 1, from search results: a result's card opens the
 * thread modal over the search page, whose address (query and all) is the
 * background — and the search page underneath is not re-mounted, so it keeps
 * its results and asks for nothing again.
 *
 * Through the real route table, like `routes/thread-route.test.tsx`.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import { testAuthor, testPostView, threadView } from "../../test/feed";
import {
  accountsPage,
  accountsStub,
  postsPage,
  postsStub,
} from "../../test/search";
import {
  backgroundOf,
  cardUnderneath,
  threadServer,
  timestampLink,
} from "../../test/thread";

const POST_TEXT = "Raptors in six, again";
const POST = testPostView({
  id: 201,
  text: POST_TEXT,
  author: testAuthor({ id: 12, username: "courtside12" }),
});

async function openFromSearch() {
  const user = userEvent.setup();
  const accounts = accountsStub({ 0: accountsPage([], null) });
  const posts = postsStub({ 0: postsPage([POST], null) });
  const thread = threadServer([threadView(POST, [])]);
  const app = renderAppAt("/search?q=raptors", "anonymous", [
    accounts.handler,
    posts.handler,
    thread.handler,
  ]);
  await screen.findByText(POST_TEXT);
  const heading = screen.getByRole("heading", { level: 1, name: "Search" });
  const card = cardUnderneath(POST_TEXT);
  const reads = posts.requests.length;

  await user.click(timestampLink(card));
  const dialog = await screen.findByRole("dialog", { name: "Thread" });
  await within(dialog).findByText(POST_TEXT);

  return { user, app, posts, heading, card, reads, dialog };
}

describe("a search result opens its thread over the search page", () => {
  it("goes to /posts/:postId with the search address as the background", async () => {
    const { app } = await openFromSearch();

    expect(app.router.state.location.pathname).toBe("/posts/201");
    expect(backgroundOf(app.router)).toMatchObject({
      pathname: "/search",
      search: "?q=raptors",
    });
  });

  it("keeps the search page underneath, the same nodes and no second read", async () => {
    const { heading, card, posts, reads } = await openFromSearch();

    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBe(
      heading,
    );
    expect(cardUnderneath(POST_TEXT)).toBe(card);
    expect(posts.requests).toHaveLength(reads);
  });

  it("closes back to the search results", async () => {
    const { user, app, dialog, heading } = await openFromSearch();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/search"),
    );
    expect(app.router.state.location.search).toBe("?q=raptors");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBe(
      heading,
    );
  });
});
