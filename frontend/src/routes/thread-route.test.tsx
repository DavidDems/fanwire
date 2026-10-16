/**
 * FRONTEND-010 criteria 1, 2 and 3 — `/posts/:postId` as a modal over the page
 * the reader was on, through the real route table.
 *
 * **The background-location pattern** (react-router's modal recipe). Opening a
 * thread navigates to `/posts/:id` with `state: { background: location }`; the
 * route table renders the background location's page with the modal over it.
 * With no background (a reload, a shared link) the feed is rendered
 * underneath. Closing is `navigate(-1)` with a background and
 * `navigate("/", { replace: true })` without one.
 *
 * **The page underneath is not re-mounted.** jsdom has no layout, so "keeps its
 * scroll position" cannot be measured here; what can be pinned is its cause.
 * A page that stays the same component instance keeps its DOM nodes, its local
 * state (the search bar's typed text) and its data (no second `GET /feed`), and
 * a re-mounted one loses all three. The browser checklist covers the scroll
 * itself (`verification.md`).
 *
 * jsdom implements no `showModal`; `setupTests.ts` shims it, and nothing here
 * depends on the shim beyond an open `<dialog>` with the dialog role.
 */
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../test/app-route";
import {
  feedPage,
  feedStub,
  testAuthor,
  testPostView,
  threadView,
} from "../test/feed";
import {
  backgroundOf,
  cardUnderneath,
  openDialog,
  threadServer,
  timestampLink,
} from "../test/thread";

const ROOT_TEXT = "Raptors in six";
const REPLY_TEXT = "Bench mob wins it";
const DEEP_TEXT = "Deeper still";

const ROOT = testPostView({
  id: 101,
  text: ROOT_TEXT,
  author: testAuthor({ id: 11, username: "courtside11" }),
  reply_count: 1,
});
const REPLY = testPostView({
  id: 111,
  text: REPLY_TEXT,
  is_reply: true,
  parent_post_id: 101,
  author: testAuthor({ id: 12, username: "bench12" }),
  created_at: "2026-09-28T12:05:00Z",
  reply_count: 1,
});
const DEEP = testPostView({
  id: 121,
  text: DEEP_TEXT,
  is_reply: true,
  parent_post_id: 111,
  created_at: "2026-09-28T12:07:00Z",
});

function arrangeThread() {
  const feed = feedStub([feedPage([ROOT], null)]);
  const thread = threadServer([
    threadView(ROOT, [REPLY]),
    threadView(REPLY, [DEEP]),
  ]);
  return { feed, thread, handlers: [feed.handler, thread.handler] };
}

async function threadDialog(): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name: "Thread" });
}

function feedHeading(): HTMLElement {
  return screen.getByRole("heading", { level: 1, name: "Feed" });
}

/** The feed at `/`, with the root's thread opened from its timestamp. */
async function openFromFeed() {
  const user = userEvent.setup();
  const { feed, thread, handlers } = arrangeThread();
  const app = renderAppAt("/", "anonymous", handlers);
  await screen.findByText(ROOT_TEXT);
  const heading = feedHeading();
  const card = cardUnderneath(ROOT_TEXT);
  const opener = timestampLink(card);
  const feedReads = feed.requests.length;

  await user.click(opener);
  const dialog = await threadDialog();
  await within(dialog).findByText(ROOT_TEXT);

  return { user, app, feed, thread, heading, card, opener, feedReads, dialog };
}

describe("opening a thread from the feed (criterion 1)", () => {
  it("changes the address to /posts/:postId, carrying the feed as the background", async () => {
    const { app } = await openFromFeed();

    expect(app.router.state.location.pathname).toBe("/posts/101");
    expect(backgroundOf(app.router)?.pathname).toBe("/");
  });

  it("asks for the thread of the post it was opened on", async () => {
    const { thread } = await openFromFeed();

    expect(thread.requests).toContain(101);
  });

  it("keeps the feed rendered underneath, the same nodes and no second read", async () => {
    const { heading, card, feed, feedReads } = await openFromFeed();

    expect(feedHeading()).toBe(heading);
    expect(card.isConnected).toBe(true);
    expect(cardUnderneath(ROOT_TEXT)).toBe(card);
    expect(feed.requests).toHaveLength(feedReads);
  });

  it("keeps the page underneath's own state: the search bar's typed text survives", async () => {
    const user = userEvent.setup();
    const { handlers } = arrangeThread();
    renderAppAt("/", "anonymous", handlers);
    await screen.findByText(ROOT_TEXT);
    const box = screen.getByRole("searchbox");
    await user.type(box, "kawhi");

    await user.click(timestampLink(cardUnderneath(ROOT_TEXT)));
    const dialog = await threadDialog();
    await within(dialog).findByText(ROOT_TEXT);
    expect(screen.getByRole("searchbox")).toHaveValue("kawhi");

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(screen.getByRole("searchbox")).toBe(box);
    expect(box).toHaveValue("kawhi");
  });

  it("opens another post's thread in the same modal, keeping the original background", async () => {
    const { user, app, dialog } = await openFromFeed();

    const replyCard = (await within(dialog).findByText(REPLY_TEXT)).closest(
      "article",
    );
    if (replyCard === null) throw new Error("the reply is not an article");
    await user.click(timestampLink(replyCard));

    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/posts/111"),
    );
    expect(backgroundOf(app.router)?.pathname).toBe("/");
    const again = await threadDialog();
    expect(await within(again).findByText(DEEP_TEXT)).toBeInTheDocument();
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    // The feed is still what is underneath.
    expect(feedHeading()).toBeInTheDocument();
  });
});

describe("closing a thread opened from the feed (criterion 2)", () => {
  it("closes on the Close button, going back to the feed without re-mounting it", async () => {
    const { user, app, dialog, heading, card, feed, feedReads } =
      await openFromFeed();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(app.router.state.historyAction).toBe("POP");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(openDialog()).toBeNull();
    expect(feedHeading()).toBe(heading);
    expect(cardUnderneath(ROOT_TEXT)).toBe(card);
    expect(feed.requests).toHaveLength(feedReads);
  });

  it("returns focus to the timestamp link that opened it", async () => {
    const { user, dialog, opener } = await openFromFeed();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes on Escape (the dialog's cancel event)", async () => {
    const { app, dialog, heading } = await openFromFeed();

    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(feedHeading()).toBe(heading);
  });

  it("closes on a click on the backdrop", async () => {
    const { app, dialog, heading } = await openFromFeed();

    fireEvent.click(dialog);

    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(feedHeading()).toBe(heading);
  });

  it("does not close on a click inside the thread", async () => {
    const { user, app, dialog } = await openFromFeed();

    await user.click(within(dialog).getByRole("heading", { name: "Thread" }));

    expect(app.router.state.location.pathname).toBe("/posts/101");
    expect(openDialog()).not.toBeNull();
  });

  it("closes on Back (history -1), leaving the feed as it was", async () => {
    const { app, heading, card } = await openFromFeed();

    await act(async () => {
      await app.router.navigate(-1);
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(app.router.state.location.pathname).toBe("/");
    expect(feedHeading()).toBe(heading);
    expect(cardUnderneath(ROOT_TEXT)).toBe(card);
  });
});

describe("opening /posts/:postId directly (criterion 3)", () => {
  it("shows the same modal over the feed", async () => {
    const { handlers } = arrangeThread();
    const app = renderAppAt("/posts/101", "anonymous", handlers);

    const dialog = await threadDialog();
    expect(await within(dialog).findByText(ROOT_TEXT)).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Feed" }),
    ).toBeInTheDocument();
    expect(backgroundOf(app.router)).toBeNull();
    // The feed underneath is the real one: its card is there outside the modal.
    expect(await screen.findAllByText(ROOT_TEXT)).toHaveLength(2);
    expect(cardUnderneath(ROOT_TEXT)).toBeInTheDocument();
  });

  it("closing it leaves the reader on the feed, replacing the thread's entry", async () => {
    const user = userEvent.setup();
    const { handlers } = arrangeThread();
    const app = renderAppAt("/posts/101", "anonymous", handlers);
    const dialog = await threadDialog();
    await within(dialog).findByText(ROOT_TEXT);

    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(app.router.state.historyAction).toBe("REPLACE");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(feedHeading()).toBeInTheDocument();
  });

  it("closes on Escape to the feed as well", async () => {
    const { handlers } = arrangeThread();
    const app = renderAppAt("/posts/101", "anonymous", handlers);
    const dialog = await threadDialog();
    await within(dialog).findByText(ROOT_TEXT);

    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
