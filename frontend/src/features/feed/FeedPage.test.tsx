/**
 * FRONTEND-005 acceptance criteria 1, 2, 6, 7 and 8 — the feed page itself.
 *
 * `GET /feed` answers a `FeedPage { items, next_before_id }` ([[0x06-feed]]
 * Routes). The cursor is keyed off the underlying query page, so `next_before_id`
 * is `null` exactly when there is no further page — which is the whole of
 * "stopping cleanly", and is why nothing here counts items to decide.
 *
 * **Paging is an explicit control, not a scroll sentinel.** jsdom implements no
 * `IntersectionObserver`, and `src/setupTests.ts` — the only place a polyfill
 * could live — is outside this unit's permitted paths, so a scroll-triggered
 * implementation would be untestable from inside the unit. Criterion 1 asks only
 * that the next page is loaded *using `next_before_id`* and that it stops when
 * the response says there is no further page; both are properties of the
 * request, not of the gesture. Same shape as the recorded `URL.createObjectURL`
 * decision in [[0x08-frontend]].
 *
 * **What criterion 2 is pinned to mean here.** A guest and a signed-in visitor
 * are rendered by the same component from the same request: the backend chooses
 * chronological or personalized ranking and the UI never learns which
 * ([[0x06-feed]] Ranking strategy). So both renders are compared *whole* — the
 * request's query string and the rendered cards — rather than by sampling one
 * post. A behavioural test alone cannot see a branch that happens to produce the
 * same output for these fixtures, so `feed-isolation.test.ts` reads the sources
 * from disk for the other half.
 *
 * **What "optimistic" is pinned to mean**, exactly as in
 * `features/profile/FollowButton.test.tsx`: the control *and* the count change
 * before the request returns, and both are restored if it fails. The like
 * request is held open from the network side rather than raced, because a
 * component that only updated once the response landed would leave the held
 * assertion timing out — which is the point.
 *
 * **Reply and repost are an address, not an import.** `/compose?reply_to=<id>`
 * and `/compose?repost_of=<id>` are read by `ComposePage` and pinned by
 * `features/compose/ComposeRoute.test.tsx`. `features/compose/**` is in this
 * unit's `forbidden_paths`, and a route is the one seam a feature folder can
 * offer another without being imported by it ([[0x00-architecture]] Connection
 * rule) — so what is asserted here is where the control *navigates to*.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { AuthService } from "../../auth/AuthService";
import { config } from "../../config";
import { FakeAuthService, profileFound, renderWithAuth, testSession } from "../../test/auth";
import {
  TEST_PUBLIC_MEDIA_KEY,
  feedPage,
  feedStub,
  likeStub,
  testAuthor,
  testMediaItem,
  testPostView,
} from "../../test/feed";
import { server } from "../../test/server";
import { FeedPage } from "./FeedPage";

const FIRST_TEXT = "Raptors in six";
const SECOND_TEXT = "Second half was a clinic";
const THIRD_TEXT = "The bench won that game";
const FOURTH_TEXT = "Free throws decided it";
const MEDIA_TEXT = "Look at this block";

const FIRST = testPostView({ id: 101, text: FIRST_TEXT });
const SECOND = testPostView({
  id: 102,
  text: SECOND_TEXT,
  author: testAuthor({ id: 12, username: "courtside12" }),
});
const THIRD = testPostView({ id: 103, text: THIRD_TEXT });
const FOURTH = testPostView({ id: 104, text: FOURTH_TEXT });

/** The same post as the server sees it once a like has landed. */
const FIRST_LIKED = testPostView({
  id: 101,
  text: FIRST_TEXT,
  like_count: 4,
  liked_by_viewer: true,
});

function ComposeStub() {
  const { pathname, search } = useLocation();
  // One expression, so the address is one text node and can be matched whole.
  return <p>{`compose stub at ${pathname}${search}`}</p>;
}

function renderFeed(authService: AuthService = new FakeAuthService()) {
  return renderWithAuth(
    <Routes>
      <Route path="/" element={<FeedPage />} />
      <Route path="/compose" element={<ComposeStub />} />
    </Routes>,
    { authService, route: "/" },
  );
}

function memberAuth(): AuthService {
  return new FakeAuthService({ session: testSession() });
}

/**
 * The post card carrying this text.
 *
 * A feed item is an `article` — the role for a self-contained composition, and
 * the one a post can honestly claim — so the cards are found by role and then
 * narrowed by their own content, never by a test id or a class name.
 */
function postCard(text: string): HTMLElement {
  const card = screen
    .getAllByRole("article")
    .find((article) => article.textContent?.includes(text));
  if (card === undefined) throw new Error(`no post card containing ${JSON.stringify(text)}`);
  return card;
}

/**
 * A control inside a card, whether it is a link or a button.
 *
 * Both are keyboard-reachable, and what these tests pin is the address a
 * reply or a repost opens rather than the element it is hung on: a `Link` and a
 * button that navigates are both correct.
 */
function control(scope: HTMLElement, name: RegExp): HTMLElement {
  const links = within(scope).queryAllByRole("link", { name });
  if (links.length > 0) return links[0];
  return within(scope).getByRole("button", { name });
}

/** Every rendered card's text, in order — what "the same posts" is compared as. */
function renderedCards(): string[] {
  return screen.getAllByRole("article").map((article) => article.textContent ?? "");
}

function loadMore(): HTMLElement | null {
  return screen.queryByRole("button", { name: /load more/i });
}

describe("the feed renders from GET /feed", () => {
  it("shows the first page, and asks for it with no cursor", async () => {
    const feed = feedStub([feedPage([FIRST, SECOND], 102)]);
    server.use(feed.handler);

    renderFeed();

    expect(await screen.findByText(FIRST_TEXT)).toBeInTheDocument();
    expect(screen.getByText(SECOND_TEXT)).toBeInTheDocument();
    // The first page is the newest posts; a `before_id` on it would silently
    // skip everything after whatever id the component invented.
    expect(feed.requests.map((request) => request.beforeId)).toEqual([null]);
  });

  it("renders under the heading the route table pins", async () => {
    const feed = feedStub([feedPage([FIRST], null)]);
    server.use(feed.handler);

    renderFeed();

    expect(await screen.findByRole("heading", { name: /^feed$/i })).toBeInTheDocument();
  });

  it("loads the next page using next_before_id from the previous response", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST, SECOND], 102), feedPage([THIRD, FOURTH], null)]);
    server.use(feed.handler);

    renderFeed();
    await screen.findByText(FIRST_TEXT);

    await user.click(screen.getByRole("button", { name: /load more/i }));

    expect(await screen.findByText(THIRD_TEXT)).toBeInTheDocument();
    expect(screen.getByText(FOURTH_TEXT)).toBeInTheDocument();
    // 102 is the cursor the *first response* carried, not the last id on screen
    // and not a count — those agree here by luck and diverge the moment view
    // assembly drops a post whose author was soft-deleted ([[0x06-feed]]).
    expect(feed.requests.map((request) => request.beforeId)).toEqual([null, "102"]);
  });

  it("keeps the pages it already has when the next one arrives", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST, SECOND], 102), feedPage([THIRD, FOURTH], null)]);
    server.use(feed.handler);

    renderFeed();
    await screen.findByText(FIRST_TEXT);
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await screen.findByText(THIRD_TEXT);

    expect(renderedCards()).toHaveLength(4);
    expect(screen.getByText(FIRST_TEXT)).toBeInTheDocument();
    expect(screen.getByText(SECOND_TEXT)).toBeInTheDocument();
  });

  it("stops cleanly once a response reports no further page", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST, SECOND], 102), feedPage([THIRD, FOURTH], null)]);
    server.use(feed.handler);

    renderFeed();
    await screen.findByText(FIRST_TEXT);
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await screen.findByText(THIRD_TEXT);

    await waitFor(() => expect(loadMore()).toBeNull());
    expect(feed.requests).toHaveLength(2);
  });

  it("offers no further page when the first response already reports none", async () => {
    const feed = feedStub([feedPage([FIRST], null)]);
    server.use(feed.handler);

    renderFeed();
    await screen.findByText(FIRST_TEXT);

    expect(loadMore()).toBeNull();
  });
});

describe("a guest and a signed-in visitor render through the same component", () => {
  it("issues the same GET /feed and renders the same cards for both", async () => {
    // `profileFound` is installed for the signed-in half only because the
    // session context may read it; the feed itself asks for neither profile.
    const feed = feedStub([feedPage([FIRST, SECOND], null)]);
    server.use(feed.handler, profileFound());

    renderFeed(new FakeAuthService());
    await screen.findByText(FIRST_TEXT);
    const asGuest = renderedCards();
    cleanup();

    renderFeed(memberAuth());
    await screen.findByText(FIRST_TEXT);
    const asMember = renderedCards();

    expect(asMember, "the same response must render the same feed either way").toEqual(asGuest);
    expect(feed.requests).toHaveLength(2);
    expect(
      feed.requests[1].search,
      "a guest request and a signed-in request are the same GET /feed",
    ).toBe(feed.requests[0].search);
  });

  it("renders the feed to a visitor with no session at all", async () => {
    // The guest feed is a read path by decision ([[0x06-feed]] Security). A feed
    // that greeted an anonymous visitor with a sign-in prompt would be a
    // regression, and it is the shape a strategy branch takes when it is wrong.
    const feed = feedStub([feedPage([FIRST], null)]);
    server.use(feed.handler);

    renderFeed(new FakeAuthService());

    expect(await screen.findByText(FIRST_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^sign\s*-?\s*in$/i })).toBeNull();
  });
});

describe("liking a post", () => {
  it("issues POST /posts/{post_id}/like for the post that was liked", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST, SECOND], null)]);
    const like = likeStub();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText(FIRST_TEXT);
    feed.answerWith(feedPage([FIRST_LIKED, SECOND], null));

    await user.click(control(postCard(FIRST_TEXT), /^like$/i));

    await waitFor(() => {
      expect(like.calls).toEqual([{ method: "POST", postId: 101 }]);
    });
  });

  it("issues DELETE /posts/{post_id}/like for a post the viewer already liked", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST_LIKED], null)]);
    const like = likeStub();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText(FIRST_TEXT);
    feed.answerWith(feedPage([FIRST], null));

    await user.click(control(postCard(FIRST_TEXT), /^unlike$/i));

    await waitFor(() => {
      expect(like.calls).toEqual([{ method: "DELETE", postId: 101 }]);
    });
  });

  it("flips the control and raises the count before the like returns", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST], null)]);
    const like = likeStub();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("3 likes");
    // What the server's own view becomes once the like lands, installed before
    // the click so that a component which re-derives from the server after the
    // request settles agrees with the optimistic guess instead of flipping back.
    feed.answerWith(feedPage([FIRST_LIKED], null));
    const release = like.hold();

    await user.click(control(postCard(FIRST_TEXT), /^like$/i));

    expect(
      await within(postCard(FIRST_TEXT)).findByRole("button", { name: /^unlike$/i }),
    ).toBeInTheDocument();
    expect(within(postCard(FIRST_TEXT)).getByText("4 likes")).toBeInTheDocument();

    release();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^unlike$/i })).toBeInTheDocument();
    });
  });

  it("flips the control and lowers the count before the unlike returns", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST_LIKED], null)]);
    const like = likeStub();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("4 likes");
    feed.answerWith(feedPage([FIRST], null));
    const release = like.hold();

    await user.click(control(postCard(FIRST_TEXT), /^unlike$/i));

    expect(
      await within(postCard(FIRST_TEXT)).findByRole("button", { name: /^like$/i }),
    ).toBeInTheDocument();
    expect(within(postCard(FIRST_TEXT)).getByText("3 likes")).toBeInTheDocument();

    release();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^like$/i })).toBeInTheDocument();
    });
  });

  it("restores the control and the count when the like fails, and says so", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST], null)]);
    const like = likeStub();
    like.fail();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("3 likes");

    await user.click(control(postCard(FIRST_TEXT), /^like$/i));

    const failure = await screen.findByRole("alert");
    expect(failure.textContent?.trim()).not.toBe("");
    expect(await screen.findByRole("button", { name: /^like$/i })).toBeInTheDocument();
    expect(await screen.findByText("3 likes")).toBeInTheDocument();
  });

  it("restores both after a failed unlike", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST_LIKED], null)]);
    const like = likeStub();
    like.fail();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText("4 likes");

    await user.click(control(postCard(FIRST_TEXT), /^unlike$/i));

    const failure = await screen.findByRole("alert");
    expect(failure.textContent?.trim()).not.toBe("");
    expect(await screen.findByRole("button", { name: /^unlike$/i })).toBeInTheDocument();
    expect(await screen.findByText("4 likes")).toBeInTheDocument();
  });
});

describe("media on a post", () => {
  const WITH_MEDIA = testPostView({ id: 105, text: MEDIA_TEXT, media: [testMediaItem()] });

  it("renders the public-media key against the configured media base url", async () => {
    const feed = feedStub([feedPage([WITH_MEDIA], null)]);
    server.use(feed.handler);

    renderFeed();
    await screen.findByText(MEDIA_TEXT);

    const image = within(postCard(MEDIA_TEXT)).getByRole("img");
    expect(image.getAttribute("src")).toContain(config.mediaBaseUrl);
    expect(image.getAttribute("src")).toContain(TEST_PUBLIC_MEDIA_KEY);
    expect(image).toHaveAccessibleName();
  });

  it("renders no image at all when a media item fails to load", async () => {
    // jsdom never fires `error` on an `<img>` by itself — there is no network
    // behind the element — so the failure is provoked directly.
    const feed = feedStub([feedPage([WITH_MEDIA], null)]);
    server.use(feed.handler);

    renderFeed();
    await screen.findByText(MEDIA_TEXT);
    const image = within(postCard(MEDIA_TEXT)).getByRole("img");

    fireEvent.error(image);

    await waitFor(() => expect(image).not.toBeInTheDocument());
    // A tag query rather than a role query, deliberately: an `<img alt="">` has
    // the presentation role and is invisible to `queryByRole("img")`, and a
    // bordered alt-text box is exactly what must not be left behind
    // ([[0x06-feed]] brief — a feed of broken frames is worse than a feed of
    // text).
    const card = postCard(MEDIA_TEXT);
    expect(card.getElementsByTagName("img")).toHaveLength(0);
    // The post survives its picture; only the image goes.
    expect(within(card).getByText(MEDIA_TEXT)).toBeInTheDocument();
  });
});

describe("reply and repost open the composer by address", () => {
  it("sends a reply to /compose?reply_to=<post id>", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST, SECOND], null)]);
    server.use(feed.handler, profileFound());

    renderFeed(memberAuth());
    await screen.findByText(SECOND_TEXT);

    await user.click(control(postCard(SECOND_TEXT), /^reply$/i));

    expect(await screen.findByText("compose stub at /compose?reply_to=102")).toBeInTheDocument();
  });

  it("sends a repost to /compose?repost_of=<post id>", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([FIRST, SECOND], null)]);
    server.use(feed.handler, profileFound());

    renderFeed(memberAuth());
    await screen.findByText(FIRST_TEXT);

    await user.click(control(postCard(FIRST_TEXT), /^repost$/i));

    expect(await screen.findByText("compose stub at /compose?repost_of=101")).toBeInTheDocument();
  });

  it("reimplements no part of composing", async () => {
    // The feed offers the two entry points and nothing else: no text box, no
    // submit, no media control. `features/compose/**` is in this unit's
    // `forbidden_paths`, and `feed-isolation.test.ts` checks the import side.
    const feed = feedStub([feedPage([FIRST], null)]);
    server.use(feed.handler, profileFound());

    renderFeed(memberAuth());
    await screen.findByText(FIRST_TEXT);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^post$/i })).toBeNull();
  });
});
