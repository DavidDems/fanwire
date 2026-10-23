/**
 * FRONTEND-012 criteria 1, 2, 3 and 4 — the post menu, on the feed's cards.
 *
 * Driven through the real route table (`renderAppAt`), because who sees which
 * item is the account state (`useAccount()`) as the whole app sees it, and a
 * deletion has to reach every cache the app holds.
 *
 * - **One menu per card** (criterion 1): every card — a post, a plain repost, a
 *   quote — has exactly one "More options" button; the original inside a quote
 *   is part of the quote's card and has none of its own.
 * - **Copy link** (criterion 2), for everyone: `navigator.clipboard.writeText`
 *   with the post's absolute address (origin + `/posts/<id>`), then "Link
 *   copied" in a polite status. A clipboard that refuses, or none at all,
 *   shows the address in a read-only, pre-selected field — never nothing.
 * - **Report** (criterion 3): a signed-in active member, on another member's
 *   post only. A confirm (`alertdialog` "Report this post?", Report and
 *   Cancel, focus on Cancel); one `POST /posts/<id>/report`; then "Reported",
 *   disabled, for the rest of the session — wherever that post is shown in
 *   this app — and offered again by a fresh app (a reload). A failure is an
 *   alert in the confirm, which stays open.
 * - **Delete** (criterion 4): only on the viewer's own post (`post.author.id`
 *   against `GET /users/me`'s id), never on a plain repost. A confirm ("Delete
 *   this post?", Delete and Cancel, focus on Cancel); `DELETE /posts/<id>`; on
 *   204 the card leaves at once — before the feed's refetch has answered —
 *   and the feed is then read again. A 403, 404 or 409 is an alert saying
 *   which, and the card stays.
 *
 * The deactivated account's menu (neither Report nor Delete) is
 * `routes/deactivated.test.tsx`'s; the thread modal's cards are
 * `features/thread/post-menu.test.tsx`'s; search's are
 * `features/search/search-menu.test.tsx`'s.
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RequestHandler } from "msw";
import { describe, expect, it } from "vitest";

import { renderAppAt, type Visitor } from "../../test/app-route";
import { gamesAre } from "../../test/compose";
import {
  feedPage,
  testAuthor,
  testPlainRepost,
  testPostView,
  testQuoteRepost,
  threadView,
  type PostView,
} from "../../test/feed";
import { signedInShown, signedOutShown } from "../../test/post-about";
import {
  MORE_OPTIONS,
  deletePostStub,
  feedServer,
  isDisabled,
  itemNames,
  menuButton,
  openMenu,
  ownPost,
  postAddress,
  reportStub,
  stubClipboard,
} from "../../test/post-menu";
import { cardUnderneath, threadServer, timestampLink } from "../../test/thread";

const THEIR_TEXT = "Raptors in six";
const OWN_TEXT = "My own take";
const ORIGINAL_TEXT = "The original take";
const QUOTE_TEXT = "Quoting this one";

/** Another member's post. */
const THEIRS = testPostView({
  id: 101,
  text: THEIR_TEXT,
  author: testAuthor({ id: 11, username: "courtside11" }),
});

/** The signed-in member's own post (`testProfile()`'s id, 7). */
const MINE = ownPost({ id: 301, text: OWN_TEXT });

const ORIGINAL = testPostView({
  id: 401,
  text: ORIGINAL_TEXT,
  author: testAuthor({ id: 21, username: "original21" }),
});

async function arrange(
  as: Visitor,
  posts: PostView[],
  extra: RequestHandler[] = [],
) {
  const user = userEvent.setup();
  const feed = feedServer(feedPage(posts, null));
  const app = renderAppAt("/", as, [feed.handler, gamesAre(), ...extra]);
  if (as === "anonymous") await signedOutShown();
  else await signedInShown();
  await screen.findAllByRole("article");
  return { user, feed, app };
}

/** Every top-level card in the feed: articles with no article around them. */
function topCards(): HTMLElement[] {
  return screen
    .getAllByRole("article")
    .filter((article) => article.parentElement?.closest("article") === null);
}

async function confirmNamed(name: string): Promise<HTMLElement> {
  return screen.findByRole("alertdialog", { name });
}

describe("every card has one More options menu (criterion 1)", () => {
  it.each(["anonymous", "member"] as const)(
    "%s: a post, a plain repost and a quote each have exactly one",
    async (as) => {
      await arrange(as, [
        THEIRS,
        testPlainRepost(ORIGINAL, { id: 402 }),
        testQuoteRepost(ORIGINAL, QUOTE_TEXT, { id: 403 }),
      ]);

      const cards = topCards();
      expect(cards).toHaveLength(3);
      for (const card of cards) {
        expect(
          within(card).getAllByRole("button", { name: MORE_OPTIONS }),
          (card.textContent ?? "").slice(0, 40),
        ).toHaveLength(1);
      }
    },
  );

  it("the menu button says it opens a menu, closed until it is opened", async () => {
    const { user } = await arrange("anonymous", [THEIRS]);
    const button = menuButton(cardUnderneath(THEIR_TEXT));

    expect(button.getAttribute("aria-haspopup")).toMatch(/^(menu|true)$/);
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("opening the menu does not open the post's thread", async () => {
    const { user, app } = await arrange("anonymous", [THEIRS]);

    await openMenu(user, cardUnderneath(THEIR_TEXT));

    expect(app.router.state.location.pathname).toBe("/");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Copy link to a guest, and nothing a guest cannot do", async () => {
    const { user } = await arrange("anonymous", [THEIRS]);

    const menu = await openMenu(user, cardUnderneath(THEIR_TEXT));

    expect(itemNames(menu)).toEqual(["Copy link"]);
  });
});

describe("Copy link (criterion 2)", () => {
  it("writes the post's absolute address to the clipboard", async () => {
    const { user } = await arrange("anonymous", [THEIRS]);
    const writeText = stubClipboard("writes");

    const menu = await openMenu(user, cardUnderneath(THEIR_TEXT));
    await user.click(within(menu).getByRole("menuitem", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(postAddress(101));
    expect(postAddress(101)).toMatch(/^https?:\/\/[^/]+\/posts\/101$/);
  });

  it("announces Link copied in a polite status", async () => {
    const { user } = await arrange("anonymous", [THEIRS]);
    stubClipboard("writes");

    const menu = await openMenu(user, cardUnderneath(THEIR_TEXT));
    await user.click(within(menu).getByRole("menuitem", { name: "Copy link" }));

    await waitFor(() =>
      expect(
        screen
          .queryAllByRole("status")
          .some((status) => (status.textContent ?? "").includes("Link copied")),
      ).toBe(true),
    );
    expect(screen.queryByDisplayValue(postAddress(101))).toBeNull();
  });

  it.each(["refuses", "missing"] as const)(
    "a clipboard that %s shows the address in a read-only, pre-selected field",
    async (mode) => {
      const { user } = await arrange("anonymous", [THEIRS]);
      stubClipboard(mode);

      const menu = await openMenu(user, cardUnderneath(THEIR_TEXT));
      await user.click(
        within(menu).getByRole("menuitem", { name: "Copy link" }),
      );

      const field = (await screen.findByDisplayValue(
        postAddress(101),
      )) as HTMLInputElement;
      expect(field.readOnly).toBe(true);
      expect(field).toHaveAccessibleName();
      await waitFor(() => {
        expect(field.selectionStart).toBe(0);
        expect(field.selectionEnd).toBe(postAddress(101).length);
      });
      expect(
        screen
          .queryAllByRole("status")
          .some((status) => (status.textContent ?? "").includes("Link copied")),
        "nothing was copied, so nothing says it was",
      ).toBe(false);
    },
  );
});

describe("who is offered Report (criterion 3)", () => {
  it("a signed-in member, on another member's post", async () => {
    const { user } = await arrange("member", [THEIRS]);

    const menu = await openMenu(user, cardUnderneath(THEIR_TEXT));

    expect(itemNames(menu)).toContain("Report");
  });

  it("never on the member's own post", async () => {
    const { user } = await arrange("member", [MINE]);

    const menu = await openMenu(user, cardUnderneath(OWN_TEXT));

    expect(itemNames(menu)).not.toContain("Report");
  });

  it("never to a guest", async () => {
    const { user } = await arrange("anonymous", [THEIRS]);

    const menu = await openMenu(user, cardUnderneath(THEIR_TEXT));

    expect(itemNames(menu)).not.toContain("Report");
  });
});

describe("reporting a post (criterion 3)", () => {
  async function openReport(extra: RequestHandler[] = []) {
    const report = reportStub();
    const arranged = await arrange(
      "member",
      [THEIRS],
      [report.handler, ...extra],
    );
    const card = cardUnderneath(THEIR_TEXT);
    const menu = await openMenu(arranged.user, card);
    await arranged.user.click(
      within(menu).getByRole("menuitem", { name: "Report" }),
    );
    const confirm = await confirmNamed("Report this post?");
    return { ...arranged, report, card, confirm };
  }

  it("asks first: an alertdialog with Report and Cancel, focus on Cancel", async () => {
    const { confirm, report } = await openReport();

    const cancel = within(confirm).getByRole("button", { name: "Cancel" });
    expect(
      within(confirm).getByRole("button", { name: "Report" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(report.calls).toEqual([]);
  });

  it("Cancel sends nothing and returns focus to the menu button", async () => {
    const { user, confirm, card, report } = await openReport();

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(report.calls).toEqual([]);
    await waitFor(() => expect(menuButton(card)).toHaveFocus());
  });

  it("confirming sends POST /posts/<id>/report once", async () => {
    const { user, confirm, report } = await openReport();
    const release = report.hold();

    const send = within(confirm).getByRole("button", { name: "Report" });
    await user.click(send);
    // A second press while the first is in flight is not a second report.
    if (send.isConnected && !isDisabled(send)) await user.click(send);
    release();

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(report.calls).toEqual([101]);
  });

  it("then reads Reported, disabled, and sends nothing more", async () => {
    const { user, confirm, card, report } = await openReport();

    await user.click(within(confirm).getByRole("button", { name: "Report" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    const menu = await openMenu(user, card);
    expect(itemNames(menu)).not.toContain("Report");
    const reported = within(menu).getByRole("menuitem", { name: "Reported" });
    expect(isDisabled(reported)).toBe(true);

    await user.click(reported);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(report.calls).toEqual([101]);
  });

  it("stays Reported wherever that post is shown for the rest of the session", async () => {
    const thread = threadServer([threadView(THEIRS, [])]);
    const { user, confirm, card } = await openReport([thread.handler]);
    await user.click(within(confirm).getByRole("button", { name: "Report" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    // The same post, as the thread modal's root card: a different PostNode.
    await user.click(timestampLink(card));
    const dialog = await screen.findByRole("dialog", { name: "Thread" });
    const root = (await within(dialog).findAllByRole("article"))[0];
    const menu = await openMenu(user, root);

    expect(itemNames(menu)).toContain("Reported");
    expect(itemNames(menu)).not.toContain("Report");
  });

  it("a fresh app (a reload) offers Report again", async () => {
    const first = await openReport();
    await first.user.click(
      within(first.confirm).getByRole("button", { name: "Report" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    cleanup();

    const { user } = await arrange("member", [THEIRS]);
    const menu = await openMenu(user, cardUnderneath(THEIR_TEXT));

    expect(itemNames(menu)).toContain("Report");
  });

  it("a failure is an alert in the confirm, which stays open", async () => {
    const { user, confirm, card, report } = await openReport();
    report.fail(500);

    await user.click(within(confirm).getByRole("button", { name: "Report" }));

    expect(await within(confirm).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "Report this post?" })).toBe(
      confirm,
    );
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    const menu = await openMenu(user, card);
    expect(itemNames(menu), "nothing was reported").toContain("Report");
  });
});

describe("who is offered Delete (criterion 4)", () => {
  it("the member, on their own post", async () => {
    const { user } = await arrange("member", [MINE]);

    const menu = await openMenu(user, cardUnderneath(OWN_TEXT));

    expect(itemNames(menu)).toContain("Delete");
  });

  it("the member, on their own quote (a quote is a post of its own)", async () => {
    const { user } = await arrange("member", [
      testQuoteRepost(ORIGINAL, QUOTE_TEXT, { id: 403, author: MINE.author }),
    ]);

    const menu = await openMenu(user, cardUnderneath(QUOTE_TEXT));

    expect(itemNames(menu)).toContain("Delete");
  });

  it("never on another member's post", async () => {
    const { user } = await arrange("member", [THEIRS]);

    const menu = await openMenu(user, cardUnderneath(THEIR_TEXT));

    expect(itemNames(menu)).not.toContain("Delete");
  });

  it("never on the member's own plain repost (Undo repost removes that)", async () => {
    const { user } = await arrange("member", [
      testPlainRepost(ORIGINAL, { id: 402, author: MINE.author }),
    ]);

    const menu = await openMenu(user, cardUnderneath(ORIGINAL_TEXT));

    expect(itemNames(menu)).not.toContain("Delete");
  });

  it("never to a guest, even on the post the member wrote", async () => {
    const { user } = await arrange("anonymous", [MINE]);

    const menu = await openMenu(user, cardUnderneath(OWN_TEXT));

    expect(itemNames(menu)).not.toContain("Delete");
  });
});

describe("deleting the member's own post (criterion 4)", () => {
  const OTHER = testPostView({ id: 102, text: "Still here" });

  async function openDelete() {
    const deletion = deletePostStub();
    const arranged = await arrange("member", [MINE, OTHER], [deletion.handler]);
    const card = cardUnderneath(OWN_TEXT);
    const menu = await openMenu(arranged.user, card);
    await arranged.user.click(
      within(menu).getByRole("menuitem", { name: "Delete" }),
    );
    const confirm = await confirmNamed("Delete this post?");
    return { ...arranged, deletion, card, confirm };
  }

  it("asks first: an alertdialog with Delete and Cancel, focus on Cancel", async () => {
    const { confirm, deletion } = await openDelete();

    const cancel = within(confirm).getByRole("button", { name: "Cancel" });
    expect(
      within(confirm).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(deletion.calls).toEqual([]);
  });

  it("Cancel sends nothing, keeps the card and returns focus to the menu button", async () => {
    const { user, confirm, card, deletion } = await openDelete();

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deletion.calls).toEqual([]);
    expect(cardUnderneath(OWN_TEXT)).toBe(card);
    await waitFor(() => expect(menuButton(card)).toHaveFocus());
  });

  it("confirming sends DELETE /posts/<id>", async () => {
    const { user, confirm, deletion } = await openDelete();

    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deletion.calls).toEqual([301]));
  });

  it("on 204 the card leaves at once, before the feed is read again", async () => {
    const { user, confirm, feed } = await openDelete();
    const reads = feed.requests.length;
    // The server's next answer no longer has it — but that answer is held, so
    // a card that goes now went because the cache was edited, not refetched.
    feed.answerWith(feedPage([OTHER], null));
    const release = feed.hold();

    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText(OWN_TEXT)).toBeNull());
    expect(screen.getByText("Still here")).toBeInTheDocument();
    release();
    // …and then the feed is invalidated, so the server's own page comes back.
    await waitFor(() => expect(feed.requests.length).toBeGreaterThan(reads));
    expect(screen.queryByText(OWN_TEXT)).toBeNull();
  });

  it.each([403, 404, 409])(
    "a %i is an alert saying what happened, and the card stays",
    async (status) => {
      const { user, confirm, deletion } = await openDelete();
      deletion.fail(status);

      await user.click(within(confirm).getByRole("button", { name: "Delete" }));

      const alert = await screen.findByRole("alert");
      expect((alert.textContent ?? "").trim()).not.toBe("");
      expect(cardUnderneath(OWN_TEXT)).toBeInTheDocument();
    },
  );

  it("names each of 403, 404 and 409 differently", async () => {
    const texts: string[] = [];
    for (const status of [403, 404, 409]) {
      const { user, confirm, deletion } = await openDelete();
      deletion.fail(status);
      await user.click(within(confirm).getByRole("button", { name: "Delete" }));
      texts.push((await screen.findByRole("alert")).textContent ?? "");
      cleanup();
    }

    expect(new Set(texts).size, texts.join(" | ")).toBe(3);
  });
});
