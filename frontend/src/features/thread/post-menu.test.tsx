/**
 * FRONTEND-012 criteria 1, 5 and 6 — the post menu inside the thread modal.
 *
 * - **Every card in the modal has its menu** (criterion 1): the root and each
 *   reply, one "More options" each.
 * - **The menu's Escape stays in the menu.** It closes the menu, and is
 *   default-prevented, so the modal around it — whose way out Escape also is
 *   (`FRONTEND-011`) — does not close as well.
 * - **A confirm opened in the modal is nested over it** (criterion 5): an
 *   `alertdialog` on top of the "Thread" dialog. Escape there (its `cancel`)
 *   or Cancel closes only the confirm and returns focus to the menu button;
 *   the modal flow's address, its depth (no Back at the first detail) and its
 *   Close are exactly as they were.
 * - **Deleting the open thread's root** (criterion 6) leaves the modal open on
 *   `POSTS-004`'s "Post deleted" with the surviving replies under it, and the
 *   card underneath on the feed goes. **Deleting a reply** removes it from the
 *   list, and the thread is read again so the root's counts are the server's.
 *
 * Through the real route table, opened from the feed's card as a reader would.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import { gamesAre } from "../../test/compose";
import {
  feedPage,
  testAuthor,
  testPostView,
  threadView,
} from "../../test/feed";
import { signedInShown } from "../../test/post-about";
import {
  MORE_OPTIONS,
  deletePostStub,
  feedServer,
  itemNames,
  menuButton,
  openMenu,
  ownPost,
} from "../../test/post-menu";
import { cardUnderneath, threadServer, timestampLink } from "../../test/thread";

const ROOT_TEXT = "My thread starter";
const MY_REPLY_TEXT = "My own reply";
const THEIR_REPLY_TEXT = "Their reply";

const ROOT = ownPost({ id: 101, text: ROOT_TEXT, reply_count: 2 });
const MY_REPLY = ownPost({
  id: 111,
  text: MY_REPLY_TEXT,
  is_reply: true,
  parent_post_id: 101,
  created_at: "2026-09-28T12:05:00Z",
});
const THEIR_REPLY = testPostView({
  id: 112,
  text: THEIR_REPLY_TEXT,
  is_reply: true,
  parent_post_id: 101,
  created_at: "2026-09-28T12:10:00Z",
  author: testAuthor({ id: 13, username: "defence13" }),
});

async function openThread() {
  const user = userEvent.setup();
  const feed = feedServer(feedPage([ROOT], null));
  const thread = threadServer([threadView(ROOT, [MY_REPLY, THEIR_REPLY])]);
  const deletion = deletePostStub({
    onDeleted: (postId) => {
      if (postId === ROOT.id) {
        thread.set(threadView(null, [MY_REPLY, THEIR_REPLY]));
        feed.answerWith(feedPage([], null));
      }
      if (postId === MY_REPLY.id) {
        thread.set(threadView({ ...ROOT, reply_count: 1 }, [THEIR_REPLY]));
        feed.answerWith(feedPage([{ ...ROOT, reply_count: 1 }], null));
      }
    },
  });
  const app = renderAppAt("/", "member", [
    feed.handler,
    thread.handler,
    deletion.handler,
    gamesAre(),
  ]);
  await signedInShown();
  await screen.findByText(ROOT_TEXT);

  await user.click(timestampLink(cardUnderneath(ROOT_TEXT)));
  const dialog = await screen.findByRole("dialog", { name: "Thread" });
  await within(dialog).findByText(THEIR_REPLY_TEXT);
  return { user, app, feed, thread, deletion, dialog };
}

/** Top-level cards in the dialog (no quoted boxes). */
function dialogCards(dialog: HTMLElement): HTMLElement[] {
  return within(dialog)
    .getAllByRole("article")
    .filter((article) => article.parentElement?.closest("article") === null);
}

function cardIn(dialog: HTMLElement, text: string): HTMLElement {
  const card = dialogCards(dialog).find((article) =>
    (article.textContent ?? "").includes(text),
  );
  if (card === undefined) throw new Error(`no card in the dialog with ${text}`);
  return card;
}

/** Choose Delete in the card's menu and return the confirm that opened. */
async function chooseDelete(
  user: ReturnType<typeof userEvent.setup>,
  card: HTMLElement,
): Promise<HTMLElement> {
  const menu = await openMenu(user, card);
  await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
  return screen.findByRole("alertdialog", { name: "Delete this post?" });
}

describe("the modal's cards each have their menu (criterion 1)", () => {
  it("the root and every reply have exactly one More options", async () => {
    const { dialog } = await openThread();

    const cards = dialogCards(dialog);
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(
        within(card).getAllByRole("button", { name: MORE_OPTIONS }),
      ).toHaveLength(1);
    }
  });

  it("offers Delete on the member's own reply, and Report on another's", async () => {
    const { user, dialog } = await openThread();

    const mine = await openMenu(user, cardIn(dialog, MY_REPLY_TEXT));
    expect(itemNames(mine)).toContain("Delete");
    expect(itemNames(mine)).not.toContain("Report");
    await user.keyboard("{Escape}");

    const theirs = await openMenu(user, cardIn(dialog, THEIR_REPLY_TEXT));
    expect(itemNames(theirs)).toContain("Report");
    expect(itemNames(theirs)).not.toContain("Delete");
  });
});

describe("Escape in a card's menu stays in the menu", () => {
  it("closes the menu, is default-prevented, and leaves the modal open", async () => {
    const { user, app, dialog } = await openThread();
    const card = cardIn(dialog, ROOT_TEXT);
    const menu = await openMenu(user, card);
    const item = within(menu).getAllByRole("menuitem")[0];
    await waitFor(() => expect(item).toHaveFocus());
    const before = app.router.state.location;

    const notPrevented = fireEvent.keyDown(item, { key: "Escape" });

    expect(notPrevented, "the dialog's own Escape must not run").toBe(false);
    expect(menuButton(card)).toHaveAttribute("aria-expanded", "false");
    expect(menuButton(card)).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Thread" })).toBe(dialog);
    expect(app.router.state.location).toBe(before);
  });
});

describe("a confirm in the modal is nested over it (criterion 5)", () => {
  it("is an alertdialog on top of the Thread dialog, focus on Cancel", async () => {
    const { user, dialog } = await openThread();

    const confirm = await chooseDelete(user, cardIn(dialog, ROOT_TEXT));

    expect(screen.getByRole("dialog", { name: "Thread" })).toBe(dialog);
    expect(dialog).toHaveAttribute("open");
    await waitFor(() =>
      expect(
        within(confirm).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
  });

  it.each(["Escape", "Cancel"] as const)(
    "%s closes only the confirm: same address, same depth, Close still there",
    async (how) => {
      const { user, app, dialog, deletion } = await openThread();
      const card = cardIn(dialog, ROOT_TEXT);
      const before = app.router.state.location;
      const confirm = await chooseDelete(user, card);

      if (how === "Escape") {
        // A browser reports Escape on the topmost modal dialog as its `cancel`.
        fireEvent(confirm, new Event("cancel", { cancelable: true }));
      } else {
        await user.click(
          within(confirm).getByRole("button", { name: "Cancel" }),
        );
      }

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(screen.getByRole("dialog", { name: "Thread" })).toBe(dialog);
      expect(dialog).toHaveAttribute("open");
      expect(app.router.state.location).toBe(before);
      expect(app.router.state.location.pathname).toBe("/posts/101");
      expect(
        within(dialog).queryByRole("button", { name: "Back" }),
        "still the first detail of the flow",
      ).toBeNull();
      expect(
        within(dialog).getByRole("button", { name: "Close" }),
      ).toBeInTheDocument();
      expect(deletion.calls).toEqual([]);
      await waitFor(() => expect(menuButton(card)).toHaveFocus());
    },
  );

  it("Close still leaves the whole flow afterwards, back to the feed", async () => {
    const { user, app, dialog } = await openThread();
    const confirm = await chooseDelete(user, cardIn(dialog, ROOT_TEXT));
    fireEvent(confirm, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("deleting inside the open thread (criterion 6)", () => {
  it("the root: the modal stays open on Post deleted, with the replies under it", async () => {
    const { user, app, dialog, deletion } = await openThread();

    const confirm = await chooseDelete(user, cardIn(dialog, ROOT_TEXT));
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deletion.calls).toEqual([101]));
    expect(await within(dialog).findByText("Post deleted")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).queryByText(ROOT_TEXT)).toBeNull(),
    );
    expect(within(dialog).getByText(MY_REPLY_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByText(THEIR_REPLY_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Thread" })).toBe(dialog);
    expect(app.router.state.location.pathname).toBe("/posts/101");
  });

  it("the root: its card underneath on the feed goes", async () => {
    const { user, dialog } = await openThread();

    const confirm = await chooseDelete(user, cardIn(dialog, ROOT_TEXT));
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(() => cardUnderneath(ROOT_TEXT)).toThrow());
  });

  it("a reply: it leaves the list, and the thread is read again for the root's counts", async () => {
    const { user, dialog, thread, deletion } = await openThread();
    const reads = thread.requests.length;
    expect(
      within(cardIn(dialog, ROOT_TEXT)).getByText("2 replies"),
    ).toBeInTheDocument();

    const confirm = await chooseDelete(user, cardIn(dialog, MY_REPLY_TEXT));
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deletion.calls).toEqual([111]));
    await waitFor(() =>
      expect(within(dialog).queryByText(MY_REPLY_TEXT)).toBeNull(),
    );
    expect(within(dialog).getByText(THEIR_REPLY_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(thread.requests.length).toBeGreaterThan(reads));
    expect(
      await within(cardIn(dialog, ROOT_TEXT)).findByText("1 reply"),
    ).toBeInTheDocument();
  });
});
