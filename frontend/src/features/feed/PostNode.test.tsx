/**
 * FRONTEND-005 acceptance criterion 3, as `FRONTEND-010` left it, and the
 * EVENTS-003 absence of the live-score ticker.
 *
 * **One component renders every post.** Until `FRONTEND-010` a card expanded
 * its own replies in place ("Show replies"), recursing into further
 * `PostNode`s. The thread modal (`features/thread/`) replaced that: a thread is
 * now the root's card and its replies' cards, each a `PostNode`, in the modal
 * at `/posts/:id` (`ThreadModal.test.tsx`). What stays pinned here is that the
 * card itself fetches nothing to render and carries no disclosure; how it opens
 * the thread is `open-thread.test.tsx`.
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
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderWithAuth } from "../../test/auth";
import { recordRequests, type RequestRecorder } from "../../test/compose";
import { testPostView, type PostView } from "../../test/feed";
import { PostNode } from "./PostNode";

const ROOT_TEXT = "Game thread, tip-off in ten";

const ROOT = testPostView({ id: 201, text: ROOT_TEXT, reply_count: 3 });

let recorder: RequestRecorder | null = null;

beforeEach(() => {
  recorder = recordRequests();
});

afterEach(() => {
  recorder?.stop();
  recorder = null;
});

function renderNode(post: PostView) {
  return renderWithAuth(<PostNode post={post} />);
}

describe("one PostNode renders a standalone post", () => {
  it("renders the author's saved preset avatar", async () => {
    const author = { ...ROOT.author, profile_avatar_key: "baseline" };
    renderNode(testPostView({ id: 404, author }));

    expect(await screen.findByText(ROOT_TEXT)).toBeInTheDocument();
    expect(document.querySelector("[data-avatar-key='baseline']")).toBeInTheDocument();
  });

  it("renders the post without asking for anything at all", async () => {
    renderNode(ROOT);

    expect(await screen.findByText(ROOT_TEXT)).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    // Nothing is fetched to render a card: its thread is read by the modal.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(recorder?.paths()).toEqual([]);
  });

  it("carries no Show replies disclosure, even for a post with replies", () => {
    renderNode(ROOT);

    expect(screen.queryByRole("button", { name: /show replies/i })).toBeNull();
    expect(screen.queryByText("No replies yet.")).toBeNull();
  });
});

describe("a post renders without a live-score ticker", () => {
  const MENTIONS_GAMES = testPostView({
    id: 301,
    text: "Down to the wire",
    mentioned_game_ids: [123, 789],
  });

  it("renders a post that mentions games with no Live score status region", async () => {
    renderNode(MENTIONS_GAMES);

    expect(await screen.findByText("Down to the wire")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /live score/i })).toBeNull();
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("renders a plain post with no Live score status region", async () => {
    renderNode(ROOT);

    expect(await screen.findByText(ROOT_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /live score/i })).toBeNull();
  });
});
