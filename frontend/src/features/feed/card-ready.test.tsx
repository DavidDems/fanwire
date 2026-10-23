/**
 * FRONTEND-015 criteria 1, 2, 3 and 4 — one post card, prepared before it is
 * shown.
 *
 * `PreparedPostNode` is the one wrapper every list renders a post through
 * (feed, search results, a thread's root and replies). Until its card is ready
 * it renders the shared `Skeleton` post variant, aria-hidden, with the same
 * class for every card; then the whole `PostNode` at once: author, text, data
 * link preview and images in the same render, never piecemeal. Readiness is
 * `useCardReady`'s, the one hook:
 *
 * - **Ready** when every image the card shows (its own; for a plain repost the
 *   original's) has loaded and `decode()` has settled, resolved or rejected.
 *   A card with no images is ready at once, inside the window or not: there is
 *   nothing for it to wait for.
 * - **Bounded**: an image that errors, has a null `s3_key_public`, or has not
 *   decoded within `CARD_READY_TIMEOUT_MS` (4000 ms) no longer holds the card.
 *   The card is revealed, and that image's frame shows "Image unavailable" in
 *   the same reserved space instead of the picture. It is never dropped: a
 *   dropped image is a layout shift.
 * - **Windowed**: an image card starts loading only once it is inside the
 *   prepare window (`IntersectionObserver`, `PREPARE_WINDOW_ROOT_MARGIN`), and
 *   stays a skeleton, without asking for its images, until then.
 *
 * jsdom loads no images and has no `decode()` or `IntersectionObserver`;
 * `src/test/card-ready.ts` stubs all three, and each test settles each image
 * URL itself. The 4000 ms bound is pinned with fake timers (setTimeout only,
 * so the promise chains the stubs settle still run).
 */
import { act, within } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { Skeleton } from "../../components/ui/Skeleton";
import skeletonStyles from "../../components/ui/Skeleton.module.css";
import { renderWithAuth } from "../../test/auth";
import { stubImages, stubIntersectionObserver } from "../../test/card-ready";
import {
  TEST_PUBLIC_MEDIA_KEY,
  testAuthor,
  testMediaItem,
  testPlainRepost,
  testPostView,
  testQuoteRepost,
  type PostView,
} from "../../test/feed";
import { gameFinalPreview, postWithPreview } from "../../test/previews";
import { PreparedPostNode } from "./PreparedPostNode";
import { mediaUrl } from "./api";
import {
  CARD_READY_TIMEOUT_MS,
  PREPARE_WINDOW_ROOT_MARGIN,
} from "./useCardReady";

const TEXT = "Barnes from the corner";
const UNAVAILABLE = "Image unavailable";

const KEY_A = TEST_PUBLIC_MEDIA_KEY;
const KEY_B = "media/5151/full.jpg";
const URL_A = mediaUrl(KEY_A);
const URL_B = mediaUrl(KEY_B);

/** A post with a data-link preview and one image: everything a card can show. */
const WITH_IMAGE = postWithPreview(gameFinalPreview(), {
  id: 301,
  text: TEXT,
  author: testAuthor({ id: 31, username: "corner31" }),
  media: [testMediaItem({ id: 1, s3_key_public: KEY_A })],
});

const TWO_IMAGES = testPostView({
  id: 302,
  text: TEXT,
  media: [
    testMediaItem({ id: 1, s3_key_public: KEY_A }),
    testMediaItem({ id: 2, s3_key_public: KEY_B }),
  ],
});

const NO_IMAGE = testPostView({ id: 303, text: TEXT });

function renderNode(post: PostView) {
  return renderWithAuth(<PreparedPostNode post={post} />);
}

/** The skeletons rendered in `root`: the shared post variant's class. */
function skeletonsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`.${skeletonStyles.post}`)];
}

/** Still a skeleton: the placeholder and nothing of the post at all. */
function expectSkeleton(root: HTMLElement): void {
  const skeletons = skeletonsIn(root);
  expect(skeletons, "the card is a skeleton").toHaveLength(1);
  expect(skeletons[0]).toHaveAttribute("aria-hidden", "true");
  expect(root.querySelector("article"), "no part of the card yet").toBeNull();
  expect(root.textContent, "no text leaks out of a skeleton").toBe("");
}

/** Revealed: the card and no skeleton beside it. */
function expectRevealed(root: HTMLElement): HTMLElement {
  expect(skeletonsIn(root), "no skeleton once revealed").toEqual([]);
  const card = root.querySelector("article");
  expect(card, "the card is revealed").not.toBeNull();
  return card as HTMLElement;
}

/** The `<img>` elements in `card` showing `url`. */
function imagesOf(card: HTMLElement, url: string): HTMLImageElement[] {
  return [...card.querySelectorAll("img")].filter(
    (image) => image.getAttribute("src") === url,
  );
}

/** The frame around a rendered image: its parent, which holds nothing else. */
function frameOf(image: HTMLImageElement): HTMLElement {
  const frame = image.parentElement as HTMLElement;
  expect(frame.querySelectorAll("img"), "a frame holds one image").toHaveLength(
    1,
  );
  return frame;
}

/**
 * The element around an "Image unavailable" line that has the same class as
 * an image's frame: the line sits in the very box the picture would have.
 */
function unavailableFrameLike(
  card: HTMLElement,
  frame: HTMLElement,
): HTMLElement {
  const lines = within(card).getAllByText(UNAVAILABLE);
  const framed = lines
    .map((line) => {
      let element: HTMLElement | null = line;
      while (element !== null && element !== card) {
        if (element.className === frame.className) return element;
        element = element.parentElement;
      }
      return null;
    })
    .filter((element): element is HTMLElement => element !== null);
  expect(framed, "the unavailable line sits in an image frame").toHaveLength(1);
  expect(framed[0].querySelector("img")).toBeNull();
  return framed[0];
}

function useFakeTimeouts(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

describe("the named constants", () => {
  it("bounds a card at 4000 ms", () => {
    expect(CARD_READY_TIMEOUT_MS).toBe(4000);
  });

  it("opens the window one viewport height below the view", () => {
    expect(PREPARE_WINDOW_ROOT_MARGIN.trim().split(/\s+/)).toEqual([
      expect.stringMatching(/^0(px)?$/),
      expect.stringMatching(/^0(px)?$/),
      "100%",
      expect.stringMatching(/^0(px)?$/),
    ]);
  });

  it("builds the window's IntersectionObserver with that margin", () => {
    stubImages();
    const io = stubIntersectionObserver();
    renderNode(WITH_IMAGE);

    expect(io.observers.length, "the card watches the window").toBeGreaterThan(
      0,
    );
    for (const observer of io.observers) {
      expect(observer.options.rootMargin).toBe(PREPARE_WINDOW_ROOT_MARGIN);
    }
  });
});

describe("a card waits for its images, then appears whole (criteria 1, 2)", () => {
  it("is a skeleton while its image loads, then shows author, text, preview and image in one render", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const { container } = renderNode(WITH_IMAGE);

    expectSkeleton(container);
    expect(
      images.wasRequested(URL_A),
      "an image in the window is loading",
    ).toBe(true);

    await images.load(URL_A);

    const card = expectRevealed(container);
    expect(
      within(card).getByRole("link", { name: "corner31" }),
    ).toBeInTheDocument();
    expect(within(card).getByText(TEXT)).toBeInTheDocument();
    expect(card.textContent ?? "").toMatch(/Phoenix Suns|\bPHX\b/);
    expect(imagesOf(card, URL_A)).toHaveLength(1);
    expect(within(card).queryByText(UNAVAILABLE)).toBeNull();
  });

  it("reserves an image frame in the skeleton of a card with media, and none without", () => {
    stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const withMedia = renderNode(WITH_IMAGE);
    const withMediaCount = skeletonsIn(withMedia.container)[0].querySelectorAll(
      "*",
    ).length;
    withMedia.unmount();

    // A card without media is ready at once, so the plain skeleton is measured
    // on its own.
    const { container } = renderWithAuth(<Skeleton variant="post" />);
    const plainCount = skeletonsIn(container)[0].querySelectorAll("*").length;

    expect(
      withMediaCount,
      "the media skeleton has a frame block more",
    ).toBeGreaterThan(plainCount);
  });

  it("is ready at once when it has no images, even outside the window", () => {
    stubImages();
    stubIntersectionObserver();
    const { container } = renderNode(NO_IMAGE);

    const card = expectRevealed(container);
    expect(within(card).getByText(TEXT)).toBeInTheDocument();
  });

  it("waits for every image: one loaded is not enough", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const { container } = renderNode(TWO_IMAGES);

    await images.load(URL_A);
    expectSkeleton(container);

    await images.load(URL_B);
    const card = expectRevealed(container);
    expect(imagesOf(card, URL_A)).toHaveLength(1);
    expect(imagesOf(card, URL_B)).toHaveLength(1);
  });

  it("counts a decode() that rejects as settled, and still shows the loaded image", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const { container } = renderNode(WITH_IMAGE);

    await images.loadUndecodable(URL_A);

    const card = expectRevealed(container);
    expect(imagesOf(card, URL_A)).toHaveLength(1);
  });

  it("waits for a plain repost's original's image, which is what the card shows", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const original = testPostView({
      id: 304,
      text: TEXT,
      author: testAuthor({ id: 34, username: "original34" }),
      media: [testMediaItem({ id: 1, s3_key_public: KEY_A })],
    });
    const { container } = renderNode(testPlainRepost(original, { id: 305 }));

    expectSkeleton(container);
    await images.load(URL_A);

    const card = expectRevealed(container);
    expect(within(card).getByText(/reposted/)).toBeInTheDocument();
    expect(imagesOf(card, URL_A)).toHaveLength(1);
  });

  it("waits for a quote repost's own image", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const quote = testQuoteRepost(testPostView({ id: 306 }), TEXT, {
      id: 307,
      media: [testMediaItem({ id: 2, s3_key_public: KEY_B })],
    });
    const { container } = renderNode(quote);

    expectSkeleton(container);
    await images.load(URL_B);

    expectRevealed(container);
  });
});

describe("a failed, missing or slow image never holds a card (criterion 3)", () => {
  it("reveals at once on an image error, with Image unavailable in that image's frame", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const { container } = renderNode(TWO_IMAGES);

    await images.load(URL_A);
    await images.fail(URL_B);

    const card = expectRevealed(container);
    expect(imagesOf(card, URL_B), "the failed picture is not shown").toEqual(
      [],
    );
    const frame = frameOf(imagesOf(card, URL_A)[0]);
    unavailableFrameLike(card, frame);
    // The post survives its picture.
    expect(within(card).getByText(TEXT)).toBeInTheDocument();
  });

  it("does not wait for an image with a null s3_key_public, and says Image unavailable", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const post = testPostView({
      id: 308,
      text: TEXT,
      media: [
        testMediaItem({ id: 1, s3_key_public: KEY_A }),
        testMediaItem({ id: 2, s3_key_public: null }),
      ],
    });
    const { container } = renderNode(post);

    await images.load(URL_A);

    const card = expectRevealed(container);
    const frame = frameOf(imagesOf(card, URL_A)[0]);
    unavailableFrameLike(card, frame);
    expect(
      [...card.querySelectorAll("img")].filter(
        (image) => (image.getAttribute("src") ?? "") === "",
      ),
      "no <img> without a source: it would re-request the page",
    ).toEqual([]);
  });

  it("is ready at once when its only image has a null key", () => {
    stubImages();
    stubIntersectionObserver();
    const { container } = renderNode(
      testPostView({
        id: 309,
        text: TEXT,
        media: [testMediaItem({ s3_key_public: null })],
      }),
    );

    const card = expectRevealed(container);
    expect(within(card).getByText(UNAVAILABLE)).toBeInTheDocument();
  });

  it("reveals after CARD_READY_TIMEOUT_MS when an image never answers, and not a millisecond before", async () => {
    useFakeTimeouts();
    stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const { container } = renderNode(WITH_IMAGE);
    expectSkeleton(container);

    await act(async () => {
      vi.advanceTimersByTime(CARD_READY_TIMEOUT_MS - 1);
    });
    expectSkeleton(container);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    const card = expectRevealed(container);
    expect(within(card).getByText(TEXT)).toBeInTheDocument();
    expect(within(card).getByText(UNAVAILABLE)).toBeInTheDocument();
  });

  it("bounds the whole card, not each image: one slow image beside a loaded one", async () => {
    useFakeTimeouts();
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    const { container } = renderNode(TWO_IMAGES);

    await images.load(URL_A);
    await act(async () => {
      vi.advanceTimersByTime(CARD_READY_TIMEOUT_MS);
    });

    const card = expectRevealed(container);
    expect(imagesOf(card, URL_A)).toHaveLength(1);
    expect(within(card).getAllByText(UNAVAILABLE)).toHaveLength(1);
  });

  it("starts the clock when the card enters the window, not before", async () => {
    useFakeTimeouts();
    const images = stubImages();
    const io = stubIntersectionObserver();
    const { container } = renderNode(WITH_IMAGE);

    await act(async () => {
      vi.advanceTimersByTime(CARD_READY_TIMEOUT_MS * 2);
    });
    expectSkeleton(container);
    expect(images.wasRequested(URL_A), "outside the window nothing loads").toBe(
      false,
    );

    await io.enter(container);
    expect(images.wasRequested(URL_A)).toBe(true);
    expectSkeleton(container);

    await act(async () => {
      vi.advanceTimersByTime(CARD_READY_TIMEOUT_MS);
    });
    expectRevealed(container);
  });
});
