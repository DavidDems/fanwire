/**
 * FRONTEND-012 criteria 1 and 4, from search results: a result is the feed's
 * own card, so it carries the same "More options" menu, and a post deleted
 * anywhere leaves every cached search page that holds it.
 *
 * Search's post results sit under the feed's cache root (`postsKey(q)` is
 * `["feed", "search", q]`), which is what lets the card's deletion — written
 * in `features/feed`, which never imports this folder — reach them.
 *
 * Through the real route table, like `search-thread.test.tsx`.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import { feedPage, testAuthor, testPostView } from "../../test/feed";
import { signedInShown } from "../../test/post-about";
import {
  MORE_OPTIONS,
  deletePostStub,
  feedServer,
  itemNames,
  openMenu,
  ownPost,
} from "../../test/post-menu";
import {
  accountsPage,
  accountsStub,
  postsPage,
  postsStub,
} from "../../test/search";
import { cardUnderneath } from "../../test/thread";
import { cacheHolds, type FeedCacheValue } from "../feed/api";
import { postsKey } from "./api";

const THEIR_TEXT = "Raptors in six, again";
const OWN_TEXT = "Raptors in seven, my call";

const THEIRS = testPostView({
  id: 201,
  text: THEIR_TEXT,
  author: testAuthor({ id: 12, username: "courtside12" }),
});
const MINE = ownPost({ id: 202, text: OWN_TEXT });

async function openSearch(as: "anonymous" | "member" = "member") {
  const user = userEvent.setup();
  const accounts = accountsStub({ 0: accountsPage([], null) });
  const posts = postsStub({ 0: postsPage([THEIRS, MINE], null) });
  const deletion = deletePostStub({
    onDeleted: () => {
      posts.setPage(0, postsPage([THEIRS], null));
    },
  });
  const app = renderAppAt("/search?q=raptors", as, [
    accounts.handler,
    posts.handler,
    deletion.handler,
  ]);
  if (as === "member") await signedInShown();
  await screen.findByText(OWN_TEXT);
  return { user, app, posts, deletion };
}

describe("a search result's card has the post menu (criterion 1)", () => {
  it("each result has exactly one More options", async () => {
    await openSearch("anonymous");

    for (const text of [THEIR_TEXT, OWN_TEXT]) {
      expect(
        within(cardUnderneath(text)).getAllByRole("button", {
          name: MORE_OPTIONS,
        }),
      ).toHaveLength(1);
    }
  });

  it("offers Report on another's result and Delete on the member's own", async () => {
    const { user } = await openSearch();

    const theirs = await openMenu(user, cardUnderneath(THEIR_TEXT));
    expect(itemNames(theirs)).toEqual(["Copy link", "Report"]);
    await user.keyboard("{Escape}");

    const mine = await openMenu(user, cardUnderneath(OWN_TEXT));
    expect(itemNames(mine)).toContain("Delete");
    expect(itemNames(mine)).not.toContain("Report");
  });
});

describe("deleting a post leaves the search results (criterion 4)", () => {
  it("removes the card from the results page", async () => {
    const { user, deletion } = await openSearch();

    const menu = await openMenu(user, cardUnderneath(OWN_TEXT));
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog", {
      name: "Delete this post?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deletion.calls).toEqual([202]));
    await waitFor(() => expect(screen.queryByText(OWN_TEXT)).toBeNull());
    expect(screen.getByText(THEIR_TEXT)).toBeInTheDocument();
  });

  it("removes it from a cached search page that is not on screen", async () => {
    // The member searched for something else earlier: that page is cached,
    // inactive, and still holds the post. Deleting from the feed must reach it.
    const user = userEvent.setup();
    const feed = feedServer(feedPage([MINE], null));
    const deletion = deletePostStub();
    const app = renderAppAt("/", "member", [feed.handler, deletion.handler]);
    await signedInShown();
    await screen.findByText(OWN_TEXT);
    app.queryClient.setQueryData(postsKey("earlier"), {
      pages: [postsPage([THEIRS, MINE], null)],
      pageParams: [0],
    });

    const menu = await openMenu(user, cardUnderneath(OWN_TEXT));
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog", {
      name: "Delete this post?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deletion.calls).toEqual([202]));

    await waitFor(() =>
      expect(
        cacheHolds(
          app.queryClient.getQueryData<FeedCacheValue>(postsKey("earlier")),
          202,
        ),
      ).toBe(false),
    );
  });
});
