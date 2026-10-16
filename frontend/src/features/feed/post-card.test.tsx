/**
 * UI-009 criteria 1, 2, 3, 5 and 6 — the post card's three controls.
 *
 * **Names never change with state (the human's decision, 2026-10-16).** Like
 * is always named "Like" and repost always "Repost"; what they carry is
 * `aria-pressed`, plus a filled icon so the pressed state is not colour alone.
 * Reply is a link named "Reply" with no pressed state. None of the three shows
 * a word: the name is the `aria-label`, and the control's own text is empty.
 * This supersedes criterion 1's "Unlike" / "Undo repost" wording.
 *
 * **Counts are text outside the control**, one text node each, in reading
 * order right after the control they count, and never in its accessible name
 * (a name that changes whenever anybody likes the post is announced as a
 * different control).
 *
 * **Optimistic** means what it means in `FeedPage.test.tsx`: the pressed state
 * and the count move before the server answers (the request is held open from
 * the network side), and both go back with an `InlineAlert` when it fails.
 * Behaviour is driven through `FeedPage`, because the optimistic patch lives
 * in the cache, not in the card's props.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { AuthService } from "../../auth/AuthService";
import {
  FakeAuthService,
  profileFound,
  renderWithAuth,
  testSession,
} from "../../test/auth";
import {
  feedPage,
  feedStub,
  likeStub,
  repostStub,
  testPostView,
  type PostView,
} from "../../test/feed";
import { server } from "../../test/server";
import { FeedPage } from "./FeedPage";
import { PostNode } from "./PostNode";

const TEXT = "Raptors in six";

function ComposeStub() {
  const { pathname, search } = useLocation();
  return <p>{`compose stub at ${pathname}${search}`}</p>;
}

function SignInStub() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)
    ?.from;
  return <p>{`sign-in stub, sent from ${from?.pathname ?? "nowhere"}`}</p>;
}

function renderFeed(authService: AuthService = new FakeAuthService()) {
  return renderWithAuth(
    <Routes>
      <Route path="/" element={<FeedPage />} />
      <Route
        path="/compose"
        element={
          <>
            <ComposeStub />
            {/* The same feed, from the same cache, still on screen after the reply. */}
            <FeedPage />
          </>
        }
      />
      <Route path="/sign-in" element={<SignInStub />} />
    </Routes>,
    { authService, route: "/" },
  );
}

function memberAuth(): AuthService {
  return new FakeAuthService({ session: testSession() });
}

function renderNode(post: PostView) {
  return renderWithAuth(<PostNode post={post} />);
}

function card(): HTMLElement {
  return screen.getAllByRole("article")[0];
}

function likeButton(scope: HTMLElement = card()): HTMLElement {
  return within(scope).getByRole("button", { name: "Like" });
}

function repostButton(scope: HTMLElement = card()): HTMLElement {
  return within(scope).getByRole("button", { name: "Repost" });
}

function replyLink(scope: HTMLElement = card()): HTMLElement {
  return within(scope).getByRole("link", { name: "Reply" });
}

function precedes(first: Node, second: Node): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

/** Whether the control's icon is the filled heart: a shape filled with currentColor. */
function hasFilledShape(control: HTMLElement): boolean {
  const svg = control.querySelector("svg");
  if (svg === null) throw new Error("no icon in the control");
  return svg.querySelector('[fill="currentColor"]') !== null;
}

/** The heaviest stroke the control's icon draws, from the svg and every shape in it. */
function heaviestStroke(control: HTMLElement): number {
  const svg = control.querySelector("svg");
  if (svg === null) throw new Error("no icon in the control");
  const widths = [svg, ...svg.querySelectorAll("*")]
    .map((element) => element.getAttribute("stroke-width"))
    .filter((value): value is string => value !== null)
    .map(Number);
  return Math.max(...widths);
}

describe("the three controls are icons with a fixed name (criterion 1)", () => {
  it.each([
    ["Like", () => likeButton()],
    ["Reply", () => replyLink()],
    ["Repost", () => repostButton()],
  ])("%s is named by aria-label and shows no word", (name, find) => {
    renderNode(testPostView({ text: TEXT }));

    const control = find();
    expect(control).toHaveAttribute("aria-label", name);
    expect(control).toHaveAccessibleName(name);
    expect((control.textContent ?? "").trim()).toBe("");
    expect(control.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("names like and repost the same whatever the viewer's state", () => {
    renderNode(
      testPostView({
        text: TEXT,
        liked_by_viewer: true,
        reposted_by_viewer: true,
      }),
    );

    expect(likeButton()).toHaveAttribute("aria-label", "Like");
    expect(repostButton()).toHaveAttribute("aria-label", "Repost");
    expect(screen.queryByRole("button", { name: /unlike|undo/i })).toBeNull();
  });

  it("carries aria-pressed=false on like and repost the viewer has not done", () => {
    renderNode(
      testPostView({
        text: TEXT,
        liked_by_viewer: false,
        reposted_by_viewer: false,
      }),
    );

    expect(likeButton()).toHaveAttribute("aria-pressed", "false");
    expect(repostButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("carries aria-pressed=true on like and repost the viewer has done", () => {
    renderNode(
      testPostView({
        text: TEXT,
        liked_by_viewer: true,
        reposted_by_viewer: true,
      }),
    );

    expect(likeButton()).toHaveAttribute("aria-pressed", "true");
    expect(repostButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("gives reply no pressed state: it is a link to the composer", () => {
    renderNode(testPostView({ id: 101, text: TEXT }));

    const reply = replyLink();
    expect(reply.tagName).toBe("A");
    expect(reply).not.toHaveAttribute("aria-pressed");
    expect(reply).toHaveAttribute("href", "/compose?reply_to=101");
  });

  it("shows the pressed like as a filled heart", () => {
    renderNode(testPostView({ text: TEXT, liked_by_viewer: true }));
    expect(hasFilledShape(likeButton())).toBe(true);
  });

  it("shows an unpressed like with no filled shape", () => {
    renderNode(testPostView({ text: TEXT, liked_by_viewer: false }));
    expect(hasFilledShape(likeButton())).toBe(false);
  });

  it("draws the unpressed repost at the default stroke of 2", () => {
    renderNode(testPostView({ text: TEXT, reposted_by_viewer: false }));
    const unpressed = heaviestStroke(repostButton());
    expect(unpressed).toBe(2);
  });

  it("draws the pressed repost heavier than the default stroke of 2", () => {
    renderNode(testPostView({ text: TEXT, reposted_by_viewer: true }));
    expect(heaviestStroke(repostButton())).toBeGreaterThan(2);
  });

  it("no longer offers a repost by address: nothing links to /compose?repost_of=", () => {
    const { container } = renderNode(testPostView({ text: TEXT }));

    const hrefs = [...container.querySelectorAll("a")].map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(hrefs.filter((href) => href.includes("repost_of"))).toEqual([]);
    expect(screen.queryByRole("link", { name: /repost/i })).toBeNull();
  });
});

describe("each control is followed by its count as text (criterion 2)", () => {
  it("shows the defaults as 0 replies and 0 reposts", () => {
    renderNode(testPostView({ text: TEXT }));

    expect(within(card()).getByText("3 likes")).toBeInTheDocument();
    expect(within(card()).getByText("0 replies")).toBeInTheDocument();
    expect(within(card()).getByText("0 reposts")).toBeInTheDocument();
  });

  it("uses the singular at one", () => {
    renderNode(
      testPostView({
        text: TEXT,
        like_count: 1,
        reply_count: 1,
        repost_count: 1,
      }),
    );

    expect(within(card()).getByText("1 like")).toBeInTheDocument();
    expect(within(card()).getByText("1 reply")).toBeInTheDocument();
    expect(within(card()).getByText("1 repost")).toBeInTheDocument();
  });

  it("uses the plural at two", () => {
    renderNode(
      testPostView({
        text: TEXT,
        like_count: 2,
        reply_count: 2,
        repost_count: 2,
      }),
    );

    expect(within(card()).getByText("2 likes")).toBeInTheDocument();
    expect(within(card()).getByText("2 replies")).toBeInTheDocument();
    expect(within(card()).getByText("2 reposts")).toBeInTheDocument();
  });

  it("separates thousands in the viewer's locale", () => {
    renderNode(
      testPostView({
        text: TEXT,
        like_count: 1000,
        reply_count: 1000,
        repost_count: 1000,
      }),
    );

    expect(within(card()).getByText("1,000 likes")).toBeInTheDocument();
    expect(within(card()).getByText("1,000 replies")).toBeInTheDocument();
    expect(within(card()).getByText("1,000 reposts")).toBeInTheDocument();
  });

  it("puts each count outside its control, right after it in reading order", () => {
    renderNode(
      testPostView({
        text: TEXT,
        like_count: 4,
        reply_count: 2,
        repost_count: 7,
      }),
    );

    const like = likeButton();
    const likes = within(card()).getByText("4 likes");
    const reply = replyLink();
    const replies = within(card()).getByText("2 replies");
    const repost = repostButton();
    const reposts = within(card()).getByText("7 reposts");

    for (const [control, count] of [
      [like, likes],
      [reply, replies],
      [repost, reposts],
    ]) {
      expect(control.contains(count)).toBe(false);
    }
    const order = [like, likes, reply, replies, repost, reposts];
    for (let index = 1; index < order.length; index += 1) {
      expect(
        precedes(order[index - 1], order[index]),
        `item ${index} out of order`,
      ).toBe(true);
    }
    // The name is the action; the number is never part of it.
    expect(like).toHaveAccessibleName("Like");
    expect(reply).toHaveAccessibleName("Reply");
    expect(repost).toHaveAccessibleName("Repost");
  });
});

describe("liking is optimistic (criterion 3)", () => {
  const POST = testPostView({
    id: 101,
    text: TEXT,
    like_count: 3,
    liked_by_viewer: false,
  });
  const LIKED = { ...POST, like_count: 4, liked_by_viewer: true };

  it("presses the control, fills the heart and raises the count before the server answers", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([POST], null)]);
    const like = likeStub();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("3 likes");
    feed.answerWith(feedPage([LIKED], null));
    const release = like.hold();

    await user.click(likeButton());

    await waitFor(() =>
      expect(likeButton()).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(card()).getByText("4 likes")).toBeInTheDocument();
    expect(hasFilledShape(likeButton())).toBe(true);
    expect(likeButton()).toBeDisabled();
    expect(like.calls).toEqual([{ method: "POST", postId: 101 }]);

    release();
    await waitFor(() => expect(likeButton()).not.toBeDisabled());
    expect(likeButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("unpresses and lowers the count before the server answers an unlike", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([LIKED], null)]);
    const like = likeStub();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("4 likes");
    feed.answerWith(feedPage([POST], null));
    const release = like.hold();

    await user.click(likeButton());

    await waitFor(() =>
      expect(likeButton()).toHaveAttribute("aria-pressed", "false"),
    );
    expect(within(card()).getByText("3 likes")).toBeInTheDocument();
    expect(hasFilledShape(likeButton())).toBe(false);
    expect(like.calls).toEqual([{ method: "DELETE", postId: 101 }]);

    release();
    await waitFor(() => expect(likeButton()).not.toBeDisabled());
  });

  it("puts both back and shows an InlineAlert when the like fails", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([POST], null)]);
    const like = likeStub();
    like.fail();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("3 likes");

    await user.click(likeButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.trim()).not.toBe("");
    await waitFor(() =>
      expect(likeButton()).toHaveAttribute("aria-pressed", "false"),
    );
    expect(within(card()).getByText("3 likes")).toBeInTheDocument();
    expect(hasFilledShape(likeButton())).toBe(false);
  });
});

describe("reposting is a one-click optimistic toggle (criterion 3)", () => {
  const POST = testPostView({
    id: 101,
    text: TEXT,
    repost_count: 0,
    reposted_by_viewer: false,
  });
  const REPOSTED = { ...POST, repost_count: 1, reposted_by_viewer: true };

  it("calls POST /posts/{id}/repost, pressing the control and raising the count first", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([POST], null)]);
    const repost = repostStub();
    server.use(feed.handler, ...repost.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("0 reposts");
    feed.answerWith(feedPage([REPOSTED], null));
    const release = repost.hold();

    await user.click(repostButton());

    await waitFor(() =>
      expect(repostButton()).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(card()).getByText("1 repost")).toBeInTheDocument();
    expect(heaviestStroke(repostButton())).toBeGreaterThan(2);
    expect(repostButton()).toBeDisabled();
    expect(repost.calls).toEqual([{ method: "POST", postId: 101 }]);

    release();
    await waitFor(() => expect(repostButton()).not.toBeDisabled());
    expect(repostButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("calls DELETE /posts/{id}/repost for a post the viewer already reposted", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([{ ...REPOSTED, repost_count: 2 }], null)]);
    const repost = repostStub();
    server.use(feed.handler, ...repost.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("2 reposts");
    feed.answerWith(feedPage([{ ...POST, repost_count: 1 }], null));
    const release = repost.hold();

    await user.click(repostButton());

    await waitFor(() =>
      expect(repostButton()).toHaveAttribute("aria-pressed", "false"),
    );
    expect(within(card()).getByText("1 repost")).toBeInTheDocument();
    expect(heaviestStroke(repostButton())).toBe(2);
    expect(repostButton()).toBeDisabled();
    expect(repost.calls).toEqual([{ method: "DELETE", postId: 101 }]);

    release();
    await waitFor(() => expect(repostButton()).not.toBeDisabled());
  });

  it("puts both back and shows an InlineAlert when the repost fails", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([POST], null)]);
    const repost = repostStub();
    repost.fail();
    server.use(feed.handler, ...repost.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("0 reposts");

    await user.click(repostButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.trim()).not.toBe("");
    await waitFor(() =>
      expect(repostButton()).toHaveAttribute("aria-pressed", "false"),
    );
    expect(within(card()).getByText("0 reposts")).toBeInTheDocument();
  });

  it("puts both back when the undo is refused with 409", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([REPOSTED], null)]);
    const repost = repostStub();
    repost.fail(409);
    server.use(feed.handler, ...repost.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("1 repost");

    await user.click(repostButton());

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() =>
      expect(repostButton()).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(card()).getByText("1 repost")).toBeInTheDocument();
  });
});

describe("a signed-out viewer is sent to sign-in and nothing is called (criterion 5)", () => {
  it.each([
    ["like", () => likeButton()],
    ["repost", () => repostButton()],
  ])(
    "pressing %s goes to /sign-in carrying where they were",
    async (_name, find) => {
      const user = userEvent.setup();
      const feed = feedStub([
        feedPage([testPostView({ id: 101, text: TEXT })], null),
      ]);
      const like = likeStub();
      const repost = repostStub();
      server.use(feed.handler, ...like.handlers, ...repost.handlers);

      renderFeed(new FakeAuthService());
      await screen.findByText(TEXT);

      await user.click(find());

      expect(
        await screen.findByText("sign-in stub, sent from /"),
      ).toBeInTheDocument();
      expect(like.calls).toEqual([]);
      expect(repost.calls).toEqual([]);
    },
  );
});

describe("pressing reply does not change the reply count (criterion 6)", () => {
  it("goes to /compose?reply_to=<id> and leaves the count as it was", async () => {
    const user = userEvent.setup();
    const feed = feedStub([
      feedPage([testPostView({ id: 101, text: TEXT, reply_count: 2 })], null),
    ]);
    const like = likeStub();
    const repost = repostStub();
    server.use(
      feed.handler,
      ...like.handlers,
      ...repost.handlers,
      profileFound(),
    );

    renderFeed(memberAuth());
    await screen.findByText("2 replies");

    await user.click(replyLink());

    expect(
      await screen.findByText("compose stub at /compose?reply_to=101"),
    ).toBeInTheDocument();
    expect(await within(card()).findByText("2 replies")).toBeInTheDocument();
    expect(within(card()).queryByText("3 replies")).toBeNull();
    expect(like.calls).toEqual([]);
    expect(repost.calls).toEqual([]);
  });
});
