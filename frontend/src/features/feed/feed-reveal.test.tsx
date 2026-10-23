/**
 * FRONTEND-015 criteria 1, 5, 6 and 7, through the feed page: the list side
 * of the reveal.
 *
 * - **Each card on its own**: a card waits behind its skeleton until its own
 *   pictures are ready, and the others neither hold it nor are held by it. A
 *   card without pictures is there at once.
 * - **Only the window loads** (criterion 5): a card further down than the
 *   prepare window asks for none of its pictures and stays a skeleton until
 *   it enters the window.
 * - **A refetch never takes a card back** (criterion 6): a revealed card stays
 *   on screen with its content through an invalidation (what a like, reply,
 *   repost or delete does) and is prepared again only when its picture keys
 *   changed; a Load more keeps the previous page on screen while the next one
 *   is prepared.
 * - **aria-busy** (criterion 7): the feed is busy only while its first visible
 *   cards are being prepared, not after, and not again for a Load more.
 *
 * The images and the window are `src/test/card-ready.ts`'s stubs; a test
 * settles each picture's URL itself. A list item that has not been revealed
 * holds the shared skeleton (`Skeleton.module.css`'s `post` class) and no
 * text at all.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, onTestFinished } from "vitest";

import skeletonStyles from "../../components/ui/Skeleton.module.css";
import { renderWithAuth } from "../../test/auth";
import { stubImages, stubIntersectionObserver } from "../../test/card-ready";
import {
  feedPage,
  feedStub,
  testMediaItem,
  testPostView,
  type PostView,
} from "../../test/feed";
import { createTestQueryClient } from "../../test/render";
import { server } from "../../test/server";
import { FeedPage } from "./FeedPage";
import { FEED_PAGES_KEY, mediaUrl } from "./api";

const TEXT_A = "Raptors in six";
const TEXT_B = "Second half was a clinic";
const TEXT_C = "The bench won that game";
const TEXT_PLAIN = "Free throws decided it";

const KEY_A = "media/7001/full.jpg";
const KEY_B = "media/7002/full.jpg";
const KEY_C = "media/7003/full.jpg";
const KEY_A2 = "media/7011/full.jpg";

function imagePost(id: number, text: string, key: string): PostView {
  return testPostView({
    id,
    text,
    media: [testMediaItem({ id, s3_key_public: key })],
  });
}

const A = imagePost(201, TEXT_A, KEY_A);
const B = imagePost(202, TEXT_B, KEY_B);
const C = imagePost(203, TEXT_C, KEY_C);
const PLAIN = testPostView({ id: 204, text: TEXT_PLAIN });

function renderFeed() {
  const queryClient = createTestQueryClient();
  const result = renderWithAuth(
    <Routes>
      <Route path="/" element={<FeedPage />} />
    </Routes>,
    { route: "/", queryClient },
  );
  return { ...result, queryClient };
}

/** The feed's list items, in order, once the first page has arrived. */
async function feedItems(count: number): Promise<HTMLElement[]> {
  let items: HTMLElement[] = [];
  await waitFor(() => {
    const stream = screen
      .getByRole("heading", { name: "Feed" })
      .closest("section")
      ?.querySelector("ol");
    items = stream
      ? [...stream.querySelectorAll<HTMLElement>(":scope > li")]
      : [];
    expect(items).toHaveLength(count);
  });
  return items;
}

function isSkeleton(item: HTMLElement): boolean {
  const skeleton = item.querySelector(`.${skeletonStyles.post}`);
  return (
    skeleton !== null &&
    skeleton.getAttribute("aria-hidden") === "true" &&
    item.querySelector("article") === null &&
    (item.textContent ?? "") === ""
  );
}

function isRevealed(item: HTMLElement, text: string): boolean {
  return (
    item.querySelector(`.${skeletonStyles.post}`) === null &&
    item.querySelector("article") !== null &&
    within(item).queryByText(text) !== null
  );
}

/**
 * Watch `root` for a skeleton appearing anywhere in it, for the rest of the
 * test: a card that went back to a skeleton for even one render is caught,
 * which a before-and-after check would miss.
 */
function watchForSkeletons(root: HTMLElement): { seen: () => boolean } {
  let seen = false;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (
          node instanceof HTMLElement &&
          (node.matches(`.${skeletonStyles.post}`) ||
            node.querySelector(`.${skeletonStyles.post}`) !== null)
        ) {
          seen = true;
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  onTestFinished(() => observer.disconnect());
  return { seen: () => seen };
}

/** The element marked aria-busy="true", if any. */
function busy(): Element | null {
  return document.querySelector('[aria-busy="true"]');
}

describe("each card is revealed on its own, whole (criterion 1)", () => {
  it("keeps every image card a skeleton until its own picture is ready", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    server.use(feedStub([feedPage([A, B], null)]).handler);

    renderFeed();
    const [first, second] = await feedItems(2);
    expect(isSkeleton(first)).toBe(true);
    expect(isSkeleton(second)).toBe(true);

    await images.load(mediaUrl(KEY_B));

    expect(isSkeleton(first), "A's picture is still loading").toBe(true);
    expect(isRevealed(second, TEXT_B), "B does not wait for A").toBe(true);

    await images.load(mediaUrl(KEY_A));

    expect(isRevealed(first, TEXT_A)).toBe(true);
  });

  it("gives every skeleton the same post class", async () => {
    stubImages();
    stubIntersectionObserver({ intersectAll: true });
    server.use(feedStub([feedPage([A, B, C], null)]).handler);

    renderFeed();
    const items = await feedItems(3);

    for (const item of items) {
      const skeletons = item.querySelectorAll(`.${skeletonStyles.post}`);
      expect(skeletons).toHaveLength(1);
    }
  });

  it("shows a card without pictures at once, beside image cards still preparing", async () => {
    stubImages();
    stubIntersectionObserver();
    server.use(feedStub([feedPage([PLAIN, A], null)]).handler);

    renderFeed();
    const [plain, image] = await feedItems(2);

    expect(isRevealed(plain, TEXT_PLAIN)).toBe(true);
    expect(isSkeleton(image)).toBe(true);
  });
});

describe("only the window prepares (criterion 5)", () => {
  it("asks for no picture of a card outside the window, and keeps it a skeleton", async () => {
    const images = stubImages();
    const io = stubIntersectionObserver();
    server.use(feedStub([feedPage([A, B, C], null)]).handler);

    renderFeed();
    const [first, second, third] = await feedItems(3);
    expect(images.requested, "nothing is in the window yet").toEqual([]);

    await io.enter(first);
    expect(images.wasRequested(mediaUrl(KEY_A))).toBe(true);
    expect(images.wasRequested(mediaUrl(KEY_B))).toBe(false);
    expect(images.wasRequested(mediaUrl(KEY_C))).toBe(false);

    await images.load(mediaUrl(KEY_A));
    expect(isRevealed(first, TEXT_A)).toBe(true);
    expect(isSkeleton(second)).toBe(true);
    expect(isSkeleton(third)).toBe(true);

    await io.enter(third);
    expect(images.wasRequested(mediaUrl(KEY_C))).toBe(true);
    expect(images.wasRequested(mediaUrl(KEY_B))).toBe(false);
    await images.load(mediaUrl(KEY_C));
    expect(isRevealed(third, TEXT_C)).toBe(true);
    expect(isSkeleton(second)).toBe(true);
  });

  it("builds the window from the one named margin", async () => {
    // A computed specifier, so a missing module fails this test alone rather
    // than the whole file's import.
    const hook = "./useCardReady";
    const { PREPARE_WINDOW_ROOT_MARGIN } = (await import(
      /* @vite-ignore */ hook
    )) as { PREPARE_WINDOW_ROOT_MARGIN: string };
    stubImages();
    const io = stubIntersectionObserver();
    server.use(feedStub([feedPage([A, B], null)]).handler);

    renderFeed();
    await feedItems(2);

    expect(io.observers.length).toBeGreaterThan(0);
    for (const observer of io.observers) {
      expect(observer.options.rootMargin).toBe(PREPARE_WINDOW_ROOT_MARGIN);
    }
    expect(
      io.observed().length,
      "both cards are watched",
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("a refetch keeps what is on screen (criterion 6)", () => {
  it("never returns a revealed card to a skeleton, nor prepares it again, when only its counts change", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const feed = feedStub([feedPage([A], null)]);
    server.use(feed.handler);

    const { container, queryClient } = renderFeed();
    const [item] = await feedItems(1);
    await images.load(mediaUrl(KEY_A));
    expect(isRevealed(item, TEXT_A)).toBe(true);
    const preloads = images.requestCount(mediaUrl(KEY_A));
    const watcher = watchForSkeletons(container);

    feed.answerWith(
      feedPage([{ ...A, like_count: 9, liked_by_viewer: true }], null),
    );
    await act(() =>
      queryClient.invalidateQueries({ queryKey: FEED_PAGES_KEY }),
    );

    expect(await screen.findByText("9 likes")).toBeInTheDocument();
    const [after] = await feedItems(1);
    expect(isRevealed(after, TEXT_A)).toBe(true);
    expect(watcher.seen(), "the card went back to a skeleton").toBe(false);
    expect(
      images.requestCount(mediaUrl(KEY_A)),
      "a like changes no picture, so nothing is prepared again",
    ).toBe(preloads);
  });

  it("prepares a post again when its picture changed, without taking its card back", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const feed = feedStub([feedPage([A, B], null)]);
    server.use(feed.handler);

    const { container, queryClient } = renderFeed();
    await feedItems(2);
    await images.load(mediaUrl(KEY_A));
    await images.load(mediaUrl(KEY_B));
    const preloadsOfB = images.requestCount(mediaUrl(KEY_B));
    const watcher = watchForSkeletons(container);

    const changed = imagePost(A.id, TEXT_A, KEY_A2);
    feed.answerWith(feedPage([changed, B], null));
    await act(() =>
      queryClient.invalidateQueries({ queryKey: FEED_PAGES_KEY }),
    );

    await waitFor(() =>
      expect(images.wasRequested(mediaUrl(KEY_A2))).toBe(true),
    );
    const [first, second] = await feedItems(2);
    expect(within(first).getByText(TEXT_A)).toBeInTheDocument();
    expect(isRevealed(second, TEXT_B)).toBe(true);
    expect(watcher.seen(), "a revealed card went back to a skeleton").toBe(
      false,
    );
    expect(images.requestCount(mediaUrl(KEY_B)), "B is unchanged").toBe(
      preloadsOfB,
    );
  });

  it("keeps the previous page on screen while Load more prepares the next", async () => {
    const user = userEvent.setup();
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    server.use(feedStub([feedPage([A], A.id), feedPage([B], null)]).handler);

    const { container } = renderFeed();
    const [first] = await feedItems(1);
    await images.load(mediaUrl(KEY_A));
    expect(isRevealed(first, TEXT_A)).toBe(true);
    const watcher = watchForSkeletons(first);

    await user.click(screen.getByRole("button", { name: /load more/i }));

    const [kept, next] = await feedItems(2);
    expect(kept).toBe(first);
    expect(isRevealed(kept, TEXT_A)).toBe(true);
    expect(isSkeleton(next)).toBe(true);

    await images.load(mediaUrl(KEY_B));
    expect(isRevealed(next, TEXT_B)).toBe(true);
    expect(watcher.seen(), "the first page went back to a skeleton").toBe(
      false,
    );
    expect(container.contains(first)).toBe(true);
  });
});

describe("the feed is aria-busy only while its first cards are prepared (criterion 7)", () => {
  it("is busy until the first visible cards are ready, then not", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    server.use(feedStub([feedPage([A, B], null)]).handler);

    renderFeed();
    const [first] = await feedItems(2);

    const region = busy();
    expect(
      region,
      "the feed is aria-busy while its cards are prepared",
    ).not.toBeNull();
    expect((region as Element).contains(first)).toBe(true);

    await images.load(mediaUrl(KEY_A));
    expect(busy(), "one card is still preparing").not.toBeNull();

    await images.load(mediaUrl(KEY_B));
    expect(busy()).toBeNull();
  });

  it("is never busy for a first screen with no pictures", async () => {
    stubImages();
    stubIntersectionObserver({ intersectAll: true });
    server.use(feedStub([feedPage([PLAIN], null)]).handler);

    renderFeed();
    await screen.findByText(TEXT_PLAIN);

    expect(busy()).toBeNull();
  });

  it("is not busy again while Load more prepares the next page", async () => {
    const user = userEvent.setup();
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    server.use(feedStub([feedPage([A], A.id), feedPage([B], null)]).handler);

    renderFeed();
    await feedItems(1);
    await images.load(mediaUrl(KEY_A));
    expect(busy()).toBeNull();

    await user.click(screen.getByRole("button", { name: /load more/i }));
    const [, next] = await feedItems(2);
    expect(isSkeleton(next)).toBe(true);

    expect(busy()).toBeNull();
  });
});
