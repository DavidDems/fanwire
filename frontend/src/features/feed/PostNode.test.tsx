/**
 * FRONTEND-005 acceptance criteria 3, 4 and 5 — the Composite and the Decorator.
 *
 * **Composite.** `Post` and `Thread` share one interface, and a thread's replies
 * are themselves posts ([[wiki/CodeContext/Standards/gof-patterns|GoF patterns]]
 * "Composite", [[0x03-posts]] Pattern tie-in). The brief is explicit that the
 * test which proves it is a thread rendered **three levels deep with no
 * thread-specific component in the tree** — so what is asserted is not only that
 * the nested posts appear, but that the tree contains exactly one kind of node:
 * four cards, and four of each control, at every depth. A second component for
 * threads would show up as a card that is missing one of them, or as a fifth.
 *
 * **Lazy expansion, one level at a time.** `GET /feed/thread/{post_id}` returns
 * the root plus **direct** replies only, and deeper levels expand by calling the
 * same endpoint on a reply ([[0x06-feed]] Routes). The endpoint does not offer a
 * whole thread and the shape exists to stop a client trying, so the requested
 * ids are asserted exactly: each reply's own id, once, and never the root again.
 *
 * **No live-score ticker.** EVENTS-003 retired the API-SPORTS live scores: a
 * post view no longer carries `live_scores`, and `LiveScoreTickerDecorator` is
 * gone. A post that mentions games renders with no "Live score" status region.
 * The pinned-post decorator that `gof-patterns.md` also names must still not be
 * built — no backend field marks a post as pinned. That absence, and the
 * decorator module's absence, are pinned from disk in `feed-isolation.test.ts`,
 * which sweeps for the pinned name and therefore does not spell it; so neither
 * does this file.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithAuth } from "../../test/auth";
import { testPostView, threadStub, threadView, type PostView } from "../../test/feed";
import { server } from "../../test/server";
import { PostNode } from "./PostNode";

const ROOT_TEXT = "Game thread, tip-off in ten";
const FIRST_REPLY_TEXT = "That first quarter was ugly";
const SECOND_REPLY_TEXT = "Ugly but it worked";
const THIRD_REPLY_TEXT = "It worked because of the bench";

const ROOT = testPostView({ id: 201, text: ROOT_TEXT });

function reply(id: number, text: string, parentPostId: number): PostView {
  return testPostView({ id, text, is_reply: true, parent_post_id: parentPostId });
}

const FIRST_REPLY = reply(202, FIRST_REPLY_TEXT, 201);
const SECOND_REPLY = reply(203, SECOND_REPLY_TEXT, 202);
const THIRD_REPLY = reply(204, THIRD_REPLY_TEXT, 203);

/** Each level is its own response: root plus direct replies, nothing deeper. */
function threeLevels() {
  return threadStub([
    threadView(ROOT, [FIRST_REPLY]),
    threadView(FIRST_REPLY, [SECOND_REPLY]),
    threadView(SECOND_REPLY, [THIRD_REPLY]),
  ]);
}

function renderNode(post: PostView) {
  return renderWithAuth(<PostNode post={post} />);
}

/**
 * The card *for* a post.
 *
 * An ancestor card's `textContent` contains its descendants' text as well, so
 * the card for a post is the innermost one carrying that post's text. Cards come
 * back in document order, so the deepest is the last one that its predecessors
 * contain.
 */
function cardFor(text: string): HTMLElement {
  const candidates = screen
    .getAllByRole("article")
    .filter((card) => card.textContent?.includes(text));
  if (candidates.length === 0) throw new Error(`no post card containing ${JSON.stringify(text)}`);
  return candidates.reduce((deepest, candidate) =>
    deepest.contains(candidate) ? candidate : deepest,
  );
}

/**
 * Every control with this accessible name, whether link or button.
 *
 * Reply and repost are navigations and may honestly be either; counting both is
 * what lets "one component renders every node" be a count rather than a guess.
 */
function controlsNamed(name: RegExp): HTMLElement[] {
  return [...screen.queryAllByRole("link", { name }), ...screen.queryAllByRole("button", { name })];
}

function expand(card: HTMLElement): HTMLElement {
  return within(card).getByRole("button", { name: /show replies/i });
}

describe("one PostNode renders a standalone post", () => {
  it("renders the post without asking for a thread at all", async () => {
    const thread = threeLevels();
    server.use(thread.handler);

    renderNode(ROOT);

    expect(await screen.findByText(ROOT_TEXT)).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    // Nothing is fetched to render a post that nobody has expanded — the
    // endpoint is reached only when a reader asks for the replies.
    expect(thread.requests).toEqual([]);
  });
});

describe("one PostNode renders a thread three levels deep", () => {
  async function expandThreeLevels() {
    const user = userEvent.setup();
    const thread = threeLevels();
    server.use(thread.handler);

    renderNode(ROOT);
    await screen.findByText(ROOT_TEXT);

    await user.click(expand(cardFor(ROOT_TEXT)));
    await screen.findByText(FIRST_REPLY_TEXT);

    await user.click(expand(cardFor(FIRST_REPLY_TEXT)));
    await screen.findByText(SECOND_REPLY_TEXT);

    await user.click(expand(cardFor(SECOND_REPLY_TEXT)));
    await screen.findByText(THIRD_REPLY_TEXT);

    return thread;
  }

  it("nests each reply inside the post it replies to", async () => {
    await expandThreeLevels();

    expect(cardFor(ROOT_TEXT).contains(cardFor(FIRST_REPLY_TEXT))).toBe(true);
    expect(cardFor(FIRST_REPLY_TEXT).contains(cardFor(SECOND_REPLY_TEXT))).toBe(true);
    expect(cardFor(SECOND_REPLY_TEXT).contains(cardFor(THIRD_REPLY_TEXT))).toBe(true);
  });

  it("renders every level through the same component, with no thread-specific node", async () => {
    await expandThreeLevels();

    // Four posts, and four of everything a post has. A separate component for
    // threads — or for "the root", or for "a leaf" — shows up here as a card
    // missing one of these, or as a fifth card that is not a post.
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /^like$/i })).toHaveLength(4);
    expect(controlsNamed(/^reply$/i)).toHaveLength(4);
    expect(controlsNamed(/^repost$/i)).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /show replies/i })).toHaveLength(4);
  });

  it("shows all four posts' text at once", async () => {
    await expandThreeLevels();

    for (const text of [ROOT_TEXT, FIRST_REPLY_TEXT, SECOND_REPLY_TEXT, THIRD_REPLY_TEXT]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
});

describe("expanding a reply asks for that reply's thread", () => {
  it("calls GET /feed/thread/{id} once per expansion, for the id expanded", async () => {
    const user = userEvent.setup();
    const thread = threeLevels();
    server.use(thread.handler);

    renderNode(ROOT);
    await screen.findByText(ROOT_TEXT);
    await user.click(expand(cardFor(ROOT_TEXT)));
    await screen.findByText(FIRST_REPLY_TEXT);
    await user.click(expand(cardFor(FIRST_REPLY_TEXT)));
    await screen.findByText(SECOND_REPLY_TEXT);
    await user.click(expand(cardFor(SECOND_REPLY_TEXT)));
    await screen.findByText(THIRD_REPLY_TEXT);

    // Each reply's own id, in the order they were expanded. The root's id does
    // not appear again: the endpoint returns direct replies only, so refetching
    // the root would not produce the deeper level anyway — it would just cost a
    // request and answer the same page.
    expect(thread.requests).toEqual([201, 202, 203]);
  });

  it("asks for the reply's id, not the root's, on the very first expansion below the root", async () => {
    const user = userEvent.setup();
    const thread = threeLevels();
    server.use(thread.handler);

    renderNode(ROOT);
    await screen.findByText(ROOT_TEXT);
    await user.click(expand(cardFor(ROOT_TEXT)));
    await screen.findByText(FIRST_REPLY_TEXT);

    await user.click(expand(cardFor(FIRST_REPLY_TEXT)));
    await screen.findByText(SECOND_REPLY_TEXT);

    expect(thread.requests).toEqual([201, 202]);
  });
});

describe("a post renders without a live-score ticker", () => {
  const MENTIONS_GAMES = testPostView({
    id: 301,
    text: "Down to the wire",
    mentioned_game_ids: [123, 789],
  });

  it("renders a post that mentions games with no Live score status region", async () => {
    const thread = threeLevels();
    server.use(thread.handler);

    renderNode(MENTIONS_GAMES);

    expect(await screen.findByText("Down to the wire")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /live score/i })).toBeNull();
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("renders a plain post with no Live score status region", async () => {
    const thread = threeLevels();
    server.use(thread.handler);

    renderNode(ROOT);

    expect(await screen.findByText(ROOT_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /live score/i })).toBeNull();
  });
});
