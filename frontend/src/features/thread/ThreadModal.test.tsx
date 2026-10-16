/**
 * FRONTEND-010 criteria 4, 5, 6, 7, 8 and 9 — what the thread modal shows, and
 * replying in place.
 *
 * Driven through the real route table (`renderAppAt`), because the modal is a
 * route: opening it from the feed and loading `/posts/:id` directly are the two
 * ways in, and both are used below.
 *
 * - **Content** (criterion 4): a dialog named "Thread"; the root post's card
 *   with its controls and counts; then the composer (signed in) or a sign-in
 *   link (signed out); then the direct replies, oldest first, each a post card.
 *   `GET /feed/thread/{id}` answers replies oldest first ([[0x06-feed]]
 *   `replies_to`), and the fixtures arrive that way; what is pinned is the
 *   rendered order by `created_at`. A reply's timestamp opens that reply's own
 *   thread in the same modal.
 * - **Not found and failure** (criterion 5): a 404, or an address that is not a
 *   post id, reads "Post not found" inside the modal; a failed read is an
 *   `InlineAlert` with "Try again", which reads again. Neither throws.
 * - **The composer** (criteria 6, 7, 8) is `features/compose`'s
 *   `InlineComposer`: the same text box, `#`/`$` suggestions and media widget
 *   as `/compose`, labelled "Replying to @<author>" by `aria-describedby`,
 *   focused when the modal was opened to reply (`?reply=1`) and not otherwise.
 *   A reply is `POST /posts` with `is_reply: true` and the root's id; the
 *   submit is disabled while it is in flight; on success the box clears, the
 *   reply is in the list and the root's `reply_count` on the feed card
 *   underneath comes back from the server — never moved before it answers.
 *   On failure the draft stays and an `InlineAlert` says so.
 * - **Signed out** (criterion 9): the thread, and "Sign in to reply" in place
 *   of the composer, returning to `/posts/:id`.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RequestHandler } from "msw";
import { describe, expect, it } from "vitest";

import { renderAppAt, type Visitor } from "../../test/app-route";
import { gamesAre } from "../../test/compose";
import {
  feedPage,
  feedStub,
  testAuthor,
  testPostView,
  threadView,
  type PostView,
} from "../../test/feed";
import {
  backgroundOf,
  cardUnderneath,
  replyStub,
  threadServer,
  timestampLink,
} from "../../test/thread";

const ROOT_TEXT = "Raptors in six";
const EARLY_TEXT = "Bench mob wins it";
const LATE_TEXT = "Defence travels";
const DEEP_TEXT = "Deeper still";
const NEW_TEXT = "Called it";

const ROOT = testPostView({
  id: 101,
  text: ROOT_TEXT,
  author: testAuthor({ id: 11, username: "courtside11" }),
  created_at: "2026-09-28T12:00:00Z",
  like_count: 4,
  reply_count: 2,
  repost_count: 1,
});
const EARLY = reply(111, EARLY_TEXT, "2026-09-28T12:05:00Z", 12, "bench12");
const LATE = reply(112, LATE_TEXT, "2026-09-28T12:10:00Z", 13, "defence13");
const DEEP = testPostView({
  id: 121,
  text: DEEP_TEXT,
  is_reply: true,
  parent_post_id: 111,
  created_at: "2026-09-28T12:07:00Z",
});
const NEW_REPLY = reply(113, NEW_TEXT, "2026-09-28T12:20:00Z", 7, "raptorsfan");

function reply(
  id: number,
  text: string,
  createdAt: string,
  authorId: number,
  username: string,
): PostView {
  return testPostView({
    id,
    text,
    is_reply: true,
    parent_post_id: 101,
    created_at: createdAt,
    author: testAuthor({ id: authorId, username }),
  });
}

function arrange(extra: RequestHandler[] = []) {
  const feed = feedStub([feedPage([ROOT], null)]);
  const thread = threadServer([
    threadView(ROOT, [EARLY, LATE]),
    threadView(EARLY, [DEEP]),
  ]);
  return {
    feed,
    thread,
    handlers: [feed.handler, thread.handler, gamesAre(), ...extra],
  };
}

async function threadDialog(): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name: "Thread" });
}

/** Articles in the dialog, top-level ones only (no quoted or nested boxes). */
function dialogCards(dialog: HTMLElement): HTMLElement[] {
  return within(dialog)
    .getAllByRole("article")
    .filter((article) => article.parentElement?.closest("article") === null);
}

function cardIn(dialog: HTMLElement, text: string): HTMLElement {
  const card = dialogCards(dialog).find((article) =>
    (article.textContent ?? "").includes(text),
  );
  if (card === undefined)
    throw new Error(`no card in the dialog containing ${JSON.stringify(text)}`);
  return card;
}

function precedes(first: Node, second: Node): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

/** Load `/posts/101` directly and wait for the root to be in the modal. */
async function openDirect(
  as: Visitor,
  extra: RequestHandler[] = [],
  path = "/posts/101",
) {
  const arranged = arrange(extra);
  const app = renderAppAt(path, as, arranged.handlers);
  const dialog = await threadDialog();
  await within(dialog).findByText(ROOT_TEXT);
  return { ...arranged, app, dialog, user: userEvent.setup() };
}

/** The feed at `/` as a member, with the root's thread opened from its card. */
async function openFromFeed(
  how: "timestamp" | "reply",
  extra: RequestHandler[] = [],
) {
  const user = userEvent.setup();
  const arranged = arrange(extra);
  const app = renderAppAt("/", "member", arranged.handlers);
  await screen.findByText(ROOT_TEXT);
  const card = cardUnderneath(ROOT_TEXT);

  await user.click(
    how === "timestamp"
      ? timestampLink(card)
      : within(card).getByRole("link", { name: "Reply" }),
  );
  const dialog = await threadDialog();
  await within(dialog).findByText(ROOT_TEXT);
  return { ...arranged, app, dialog, user };
}

describe("the thread modal's content (criterion 4)", () => {
  it("is a dialog named Thread, with Thread as its heading", async () => {
    const { dialog } = await openDirect("anonymous");

    expect(dialog.tagName).toBe("DIALOG");
    expect(
      within(dialog).getByRole("heading", { name: "Thread" }),
    ).toBeInTheDocument();
  });

  it("shows the root post's card with its controls and counts", async () => {
    const { dialog } = await openDirect("anonymous");

    const root = cardIn(dialog, ROOT_TEXT);
    expect(
      within(root).getByRole("button", { name: "Like" }),
    ).toBeInTheDocument();
    expect(
      within(root).getByRole("button", { name: "Repost" }),
    ).toBeInTheDocument();
    expect(
      within(root).getByRole("link", { name: "Reply" }),
    ).toBeInTheDocument();
    expect(within(root).getByText("4 likes")).toBeInTheDocument();
    expect(within(root).getByText("2 replies")).toBeInTheDocument();
    expect(within(root).getByText("1 repost")).toBeInTheDocument();
  });

  it("asks GET /feed/thread/{id} for the post in the address", async () => {
    const { thread } = await openDirect("anonymous");

    expect(thread.requests).toContain(101);
  });

  it("renders root, then the composer, then the replies oldest first", async () => {
    const { dialog } = await openDirect("member");

    await within(dialog).findByText(LATE_TEXT);
    const root = cardIn(dialog, ROOT_TEXT);
    const composer = await within(dialog).findByRole("textbox");
    const early = cardIn(dialog, EARLY_TEXT);
    const late = cardIn(dialog, LATE_TEXT);

    expect(precedes(root, composer), "the root comes first").toBe(true);
    expect(precedes(composer, early), "the composer is above the replies").toBe(
      true,
    );
    expect(precedes(early, late), "replies are oldest first").toBe(true);
    expect(dialogCards(dialog)).toHaveLength(3);
  });

  it("renders each reply as a post card with its own controls", async () => {
    const { dialog } = await openDirect("anonymous");

    await within(dialog).findByText(LATE_TEXT);
    for (const text of [EARLY_TEXT, LATE_TEXT]) {
      const card = cardIn(dialog, text);
      expect(
        within(card).getByRole("button", { name: "Like" }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("link", { name: "Reply" }),
      ).toBeInTheDocument();
      expect(card.querySelector("time")).not.toBeNull();
    }
  });

  it("opens a reply's own thread in the same modal from its timestamp", async () => {
    const { dialog, app, user, thread } = await openDirect("anonymous");

    await within(dialog).findByText(EARLY_TEXT);
    await user.click(timestampLink(cardIn(dialog, EARLY_TEXT)));

    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/posts/111"),
    );
    const again = await threadDialog();
    expect(await within(again).findByText(DEEP_TEXT)).toBeInTheDocument();
    expect(within(again).queryByText(LATE_TEXT)).toBeNull();
    expect(thread.requests).toContain(111);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
  });
});

describe("not found and failure (criterion 5)", () => {
  it("says Post not found inside the modal for a post the API does not have", async () => {
    const arranged = arrange();
    renderAppAt("/posts/999", "anonymous", arranged.handlers);

    const dialog = await threadDialog();
    expect(
      await within(dialog).findByText("Post not found"),
    ).toBeInTheDocument();
    expect(arranged.thread.requests).toContain(999);
  });

  it("says Post not found for an address that is not a post id, and asks nothing", async () => {
    const arranged = arrange();
    renderAppAt("/posts/not-a-post", "anonymous", arranged.handlers);

    const dialog = await threadDialog();
    expect(
      await within(dialog).findByText("Post not found"),
    ).toBeInTheDocument();
    expect(arranged.thread.requests).toEqual([]);
  });

  it("shows an InlineAlert with Try again for a failed read, and Try again reads again", async () => {
    const user = userEvent.setup();
    const arranged = arrange();
    arranged.thread.fail();
    renderAppAt("/posts/101", "anonymous", arranged.handlers);

    const dialog = await threadDialog();
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent?.trim()).not.toBe("");
    expect(within(dialog).queryByText(ROOT_TEXT)).toBeNull();
    const reads = arranged.thread.requests.length;

    arranged.thread.recover();
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));

    expect(await within(dialog).findByText(ROOT_TEXT)).toBeInTheDocument();
    expect(arranged.thread.requests.length).toBeGreaterThan(reads);
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });
});

describe("the reply composer (criteria 6 and 7)", () => {
  it("is labelled Replying to @<root author>, tied to the text box", async () => {
    const { dialog } = await openDirect("member");

    expect(
      await within(dialog).findByText("Replying to @courtside11"),
    ).toBeVisible();
    expect(within(dialog).getByRole("textbox")).toHaveAccessibleDescription(
      /Replying to @courtside11/,
    );
  });

  it("is labelled with the reply's author when a reply's thread is open", async () => {
    const arranged = arrange();
    renderAppAt("/posts/111", "member", arranged.handlers);

    const dialog = await threadDialog();
    await within(dialog).findByText(DEEP_TEXT);
    expect(within(dialog).getByRole("textbox")).toHaveAccessibleDescription(
      /Replying to @bench12/,
    );
  });

  it("takes focus when the modal was opened by Reply", async () => {
    const { dialog, app } = await openFromFeed("reply");

    expect(app.router.state.location.pathname).toBe("/posts/101");
    expect(app.router.state.location.search).toBe("?reply=1");
    expect(backgroundOf(app.router)?.pathname).toBe("/");
    const box = await within(dialog).findByRole("textbox");
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("does not take focus on a plain open, though focus is inside the modal", async () => {
    const { dialog } = await openFromFeed("timestamp");

    const box = await within(dialog).findByRole("textbox");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    expect(box).not.toHaveFocus();
  });

  it("offers # game suggestions as /compose does", async () => {
    const { dialog, user } = await openDirect("member");

    await user.type(within(dialog).getByRole("textbox"), "Called it #12");

    const panel = await within(dialog).findByRole("region", {
      name: "Game suggestions",
    });
    expect(
      await within(panel).findByRole("button", { name: /Game 123/ }),
    ).toBeInTheDocument();
  });

  it("offers $ team suggestions as /compose does", async () => {
    const { dialog, user } = await openDirect("member");

    await user.type(within(dialog).getByRole("textbox"), "Go $Tor");

    const panel = await within(dialog).findByRole("region", {
      name: "Team suggestions",
    });
    expect(
      await within(panel).findByRole("button", { name: /Toronto Raptors/ }),
    ).toBeInTheDocument();
  });

  it("offers media attachment as /compose does", async () => {
    const { dialog } = await openDirect("member");

    expect(within(dialog).getByLabelText(/image/i)).toBeInTheDocument();
  });

  it("submits with a button named Reply, and nothing goes to /compose", async () => {
    const { dialog, app } = await openDirect("member");

    expect(
      within(dialog).getByRole("button", { name: "Reply" }),
    ).toBeInTheDocument();
    const hrefs = [...document.querySelectorAll("dialog a")].map(
      (link) => link.getAttribute("href") ?? "",
    );
    expect(hrefs.filter((href) => href.startsWith("/compose"))).toEqual([]);
    expect(app.router.state.location.pathname).toBe("/posts/101");
  });
});

describe("posting a reply (criterion 8)", () => {
  function serverAfterReply(
    feed: ReturnType<typeof feedStub>,
    thread: ReturnType<typeof threadServer>,
  ): void {
    const updated = { ...ROOT, reply_count: 3 };
    feed.answerWith(feedPage([updated], null));
    thread.set(threadView(updated, [EARLY, LATE, NEW_REPLY]));
  }

  it("calls POST /posts with is_reply true and the root's id", async () => {
    const replies = replyStub();
    const { dialog, user } = await openDirect("member", [replies.handler]);

    await user.type(within(dialog).getByRole("textbox"), NEW_TEXT);
    await user.click(within(dialog).getByRole("button", { name: "Reply" }));

    await waitFor(() => expect(replies.bodies).toHaveLength(1));
    expect(replies.bodies[0]).toEqual({
      text: NEW_TEXT,
      media_ids: [],
      is_reply: true,
      parent_post_id: 101,
      is_repost: false,
      original_post_id: null,
    });
  });

  it("disables the submit while the reply is in flight, and moves no count before the server answers", async () => {
    let feed: ReturnType<typeof feedStub> | null = null;
    let thread: ReturnType<typeof threadServer> | null = null;
    const replies = replyStub({
      onCreated: () => {
        if (feed !== null && thread !== null) serverAfterReply(feed, thread);
      },
    });
    const opened = await openFromFeed("timestamp", [replies.handler]);
    feed = opened.feed;
    thread = opened.thread;
    const { dialog, user } = opened;

    await user.type(within(dialog).getByRole("textbox"), NEW_TEXT);
    const release = replies.hold();
    await user.click(within(dialog).getByRole("button", { name: "Reply" }));

    await waitFor(() => expect(replies.bodies).toHaveLength(1));
    expect(
      within(dialog).getByRole("button", { name: "Reply" }),
    ).toBeDisabled();
    expect(
      within(cardUnderneath(ROOT_TEXT)).getByText("2 replies"),
    ).toBeInTheDocument();
    expect(screen.queryByText("3 replies")).toBeNull();

    release();
    await waitFor(() =>
      expect(
        within(cardUnderneath(ROOT_TEXT)).getByText("3 replies"),
      ).toBeInTheDocument(),
    );
  });

  it("on success clears the box, lists the new reply and refreshes the count underneath from the server", async () => {
    let feed: ReturnType<typeof feedStub> | null = null;
    let thread: ReturnType<typeof threadServer> | null = null;
    const replies = replyStub({
      onCreated: () => {
        if (feed !== null && thread !== null) serverAfterReply(feed, thread);
      },
    });
    const opened = await openFromFeed("timestamp", [replies.handler]);
    feed = opened.feed;
    thread = opened.thread;
    const { dialog, user } = opened;
    const feedReads = feed.requests.length;

    await user.type(within(dialog).getByRole("textbox"), NEW_TEXT);
    await user.click(within(dialog).getByRole("button", { name: "Reply" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("textbox")).toHaveValue(""),
    );
    await waitFor(() => expect(cardIn(dialog, NEW_TEXT)).toBeInTheDocument());
    expect(precedes(cardIn(dialog, LATE_TEXT), cardIn(dialog, NEW_TEXT))).toBe(
      true,
    );
    await waitFor(() =>
      expect(
        within(cardUnderneath(ROOT_TEXT)).getByText("3 replies"),
      ).toBeInTheDocument(),
    );
    // The count came back in a fresh read of the feed, not from a local guess.
    expect(feed.requests.length).toBeGreaterThan(feedReads);
    await waitFor(() =>
      expect(
        within(cardIn(dialog, ROOT_TEXT)).getByText("3 replies"),
      ).toBeInTheDocument(),
    );
  });

  it("on failure keeps the draft and explains with an InlineAlert", async () => {
    const replies = replyStub();
    replies.fail();
    const { dialog, user } = await openDirect("member", [replies.handler]);

    await user.type(within(dialog).getByRole("textbox"), NEW_TEXT);
    await user.click(within(dialog).getByRole("button", { name: "Reply" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent?.trim()).not.toBe("");
    expect(within(dialog).getByRole("textbox")).toHaveValue(NEW_TEXT);
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Reply" }),
      ).toBeEnabled(),
    );
  });
});

describe("a signed-out reader (criterion 9)", () => {
  it("sees the thread, and no composer", async () => {
    const { dialog } = await openDirect("anonymous");

    expect(await within(dialog).findByText(EARLY_TEXT)).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("gets a Sign in to reply link that returns to /posts/:postId", async () => {
    const { dialog, app, user } = await openDirect("anonymous");

    const link = within(dialog).getByRole("link", { name: "Sign in to reply" });
    expect(link).toHaveAttribute("href", "/sign-in");

    await user.click(link);

    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/sign-in"),
    );
    const state = app.router.state.location.state as {
      from?: { pathname?: string };
    } | null;
    expect(state?.from?.pathname).toBe("/posts/101");
  });
});
