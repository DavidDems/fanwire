/**
 * Where focus goes after a post is deleted inside the thread modal
 * (`FRONTEND-012`, found in the browser): the card leaves with its own menu
 * button, so focus would fall out of the dialog.
 *
 * - **A reply**: the next reply's "More options", else the previous reply's,
 *   else the root's.
 * - **The root**: the modal's own Close, the modal still open.
 *
 * Through the real route table, opened from the feed's card as a reader would.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import { gamesAre } from "../../test/compose";
import {
  feedPage,
  testAuthor,
  testPostView,
  threadView,
  type PostView,
} from "../../test/feed";
import { signedInShown } from "../../test/post-about";
import {
  deletePostStub,
  feedServer,
  menuButton,
  openMenu,
  ownPost,
} from "../../test/post-menu";
import { cardUnderneath, threadServer, timestampLink } from "../../test/thread";

const ROOT_TEXT = "My thread starter";
const EARLY_TEXT = "The early reply";
const MINE_TEXT = "My own reply";
const LATE_TEXT = "The late reply";

const ROOT = ownPost({ id: 101, text: ROOT_TEXT, reply_count: 2 });

function reply(id: number, text: string, minute: number): Partial<PostView> {
  return {
    id,
    text,
    is_reply: true,
    parent_post_id: ROOT.id,
    created_at: `2026-09-28T12:${String(minute).padStart(2, "0")}:00Z`,
  };
}

const THEIRS = testAuthor({ id: 13, username: "defence13" });
const EARLY = testPostView({ ...reply(111, EARLY_TEXT, 5), author: THEIRS });
const MINE = ownPost(reply(112, MINE_TEXT, 10));
const LATE = testPostView({ ...reply(113, LATE_TEXT, 15), author: THEIRS });

async function openThread(replies: PostView[]) {
  const user = userEvent.setup();
  const feed = feedServer(feedPage([ROOT], null));
  const thread = threadServer([threadView(ROOT, replies)]);
  const deletion = deletePostStub({
    onDeleted: (postId) => {
      thread.set(
        threadView(
          postId === ROOT.id ? null : ROOT,
          replies.filter((post) => post.id !== postId),
        ),
      );
    },
  });
  renderAppAt("/", "member", [
    feed.handler,
    thread.handler,
    deletion.handler,
    gamesAre(),
  ]);
  await signedInShown();
  await screen.findByText(ROOT_TEXT);
  await user.click(timestampLink(cardUnderneath(ROOT_TEXT)));
  const dialog = await screen.findByRole("dialog", { name: "Thread" });
  await within(dialog).findByText(replies[0]?.text ?? "");
  return { user, dialog };
}

function cardIn(dialog: HTMLElement, text: string): HTMLElement {
  const card = within(dialog)
    .getAllByRole("article")
    .find((article) => (article.textContent ?? "").includes(text));
  if (card === undefined) throw new Error(`no card in the dialog with ${text}`);
  return card;
}

async function deleteCard(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  text: string,
): Promise<void> {
  const menu = await openMenu(user, cardIn(dialog, text));
  await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
  const confirm = await screen.findByRole("alertdialog", {
    name: "Delete this post?",
  });
  await user.click(within(confirm).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(within(dialog).queryByText(text)).toBeNull());
}

describe("after deleting inside the thread modal, focus stays in it", () => {
  it("a reply: the next reply's More options", async () => {
    const { user, dialog } = await openThread([EARLY, MINE, LATE]);
    const next = menuButton(cardIn(dialog, LATE_TEXT));

    await deleteCard(user, dialog, MINE_TEXT);

    await waitFor(() => expect(next).toHaveFocus());
  });

  it("the last reply: the previous reply's", async () => {
    const { user, dialog } = await openThread([EARLY, MINE]);
    const previous = menuButton(cardIn(dialog, EARLY_TEXT));

    await deleteCard(user, dialog, MINE_TEXT);

    await waitFor(() => expect(previous).toHaveFocus());
  });

  it("the only reply: the root's", async () => {
    const { user, dialog } = await openThread([MINE]);
    const root = menuButton(cardIn(dialog, ROOT_TEXT));

    await deleteCard(user, dialog, MINE_TEXT);

    await waitFor(() => expect(root).toHaveFocus());
  });

  it("the root: the modal's Close, the modal still open", async () => {
    const { user, dialog } = await openThread([EARLY]);

    await deleteCard(user, dialog, ROOT_TEXT);

    expect(await within(dialog).findByText("Post deleted")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Close" }),
      ).toHaveFocus(),
    );
  });
});
