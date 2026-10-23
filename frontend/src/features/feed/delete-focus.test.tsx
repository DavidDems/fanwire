/**
 * Where focus goes after a post is deleted from a list (`FRONTEND-012`, found
 * in the browser): the card leaves with its own menu button, so focus would
 * fall to the page and a keyboard or screen-reader reader would lose their
 * place in the feed.
 *
 * - **The next card's "More options"** in the same list, if there is one;
 * - **else the previous card's**;
 * - **else the list's heading**, focusable from script but not a tab stop.
 * - **A failed delete keeps the confirm open**, focus inside it.
 *
 * Through the real route table, on the feed: search and the profile render
 * the same cards in the same kind of list.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import { gamesAre } from "../../test/compose";
import { feedPage, testPostView, type PostView } from "../../test/feed";
import { signedInShown } from "../../test/post-about";
import {
  deletePostStub,
  feedServer,
  menuButton,
  openMenu,
  ownPost,
} from "../../test/post-menu";
import { cardUnderneath } from "../../test/thread";

const FIRST_TEXT = "First in the feed";
const MINE_TEXT = "My own take";
const LAST_TEXT = "Last in the feed";

const FIRST = testPostView({ id: 101, text: FIRST_TEXT });
const MINE = ownPost({ id: 301, text: MINE_TEXT });
const LAST = testPostView({ id: 102, text: LAST_TEXT });

async function openDelete(posts: PostView[]) {
  const user = userEvent.setup();
  const feed = feedServer(feedPage(posts, null));
  const deletion = deletePostStub();
  renderAppAt("/", "member", [feed.handler, deletion.handler, gamesAre()]);
  await signedInShown();
  await screen.findByText(MINE_TEXT);
  // The server's next answer has it gone too, so the refetch keeps it gone.
  feed.answerWith(
    feedPage(
      posts.filter((post) => post.id !== MINE.id),
      null,
    ),
  );

  const menu = await openMenu(user, cardUnderneath(MINE_TEXT));
  await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
  const confirm = await screen.findByRole("alertdialog", {
    name: "Delete this post?",
  });
  return { user, deletion, confirm };
}

async function confirmDelete(
  user: ReturnType<typeof userEvent.setup>,
  confirm: HTMLElement,
): Promise<void> {
  await user.click(within(confirm).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByText(MINE_TEXT)).toBeNull());
}

describe("after deleting a post from a list, focus stays in the list", () => {
  it("moves to the next card's More options", async () => {
    const { user, confirm } = await openDelete([FIRST, MINE, LAST]);
    const next = menuButton(cardUnderneath(LAST_TEXT));

    await confirmDelete(user, confirm);

    await waitFor(() => expect(next).toHaveFocus());
  });

  it("moves to the previous card's when it was the last one", async () => {
    const { user, confirm } = await openDelete([FIRST, MINE]);
    const previous = menuButton(cardUnderneath(FIRST_TEXT));

    await confirmDelete(user, confirm);

    await waitFor(() => expect(previous).toHaveFocus());
  });

  it("moves to the list's heading when it was the only one, outside the tab order", async () => {
    const { user, confirm } = await openDelete([MINE]);

    await confirmDelete(user, confirm);

    const heading = screen.getByRole("heading", { level: 1, name: "Feed" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  it("a failed delete keeps the confirm open, with focus in it", async () => {
    const { user, confirm, deletion } = await openDelete([FIRST, MINE]);
    deletion.fail(403);

    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(await within(confirm).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(MINE_TEXT)).toBeInTheDocument();
    expect(confirm.contains(document.activeElement)).toBe(true);
  });
});
