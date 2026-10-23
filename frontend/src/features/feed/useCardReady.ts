import { createContext, useCallback, useEffect, useRef, useState } from "react";

import {
  isPlainRepost,
  mediaUrl,
  type MediaItemView,
  type PostView,
} from "./api";

/**
 * When a post card is ready to be shown (`FRONTEND-015`): the one rule every
 * list applies, through `PreparedPostNode`.
 *
 * **Ready** means every picture the card shows has loaded and `decode()` has
 * settled, resolved or rejected. The author, the text and the data-link preview
 * are already in the response, so pictures are the only thing a card waits
 * for, and a card without any is ready at once.
 *
 * **Bounded**: a picture that errors, has no public key yet, or has not
 * settled `CARD_READY_TIMEOUT_MS` after the card entered the prepare window
 * stops holding the card. It is shown as "Image unavailable" in its frame
 * instead, never dropped: a dropped picture is a layout shift.
 *
 * **Windowed**: pictures are asked for only once the card is within
 * `PREPARE_WINDOW_ROOT_MARGIN` of the view (`usePrepareWindow`).
 *
 * **A revealed card stays revealed.** Readiness is kept per post id and
 * picture URL in the card's own state, so a refetch that changes counts (a
 * like, a reply) finds every picture already settled and prepares nothing; a
 * picture whose key changed is prepared again inside the card already shown,
 * in its frame, which holds its size meanwhile.
 */

/** How long a card waits for its pictures once it is in the window. */
export const CARD_READY_TIMEOUT_MS = 4000;

/** The prepare window: the view, and one viewport height below it. */
export const PREPARE_WINDOW_ROOT_MARGIN = "0px 0px 100% 0px";

/**
 * Where one picture stands. `pending` is seen only by a card already revealed
 * whose picture changed; `unavailable` is an error, a missing key or the bound.
 */
export type CardImageStatus = "pending" | "loaded" | "unavailable";

/**
 * What the pictures inside a prepared card read their status from. `null`
 * outside `PreparedPostNode` (a bare `PostNode`), where a picture is simply
 * rendered and falls back on its own `error`.
 */
export const CardImageContext = createContext<
  ((url: string) => CardImageStatus) | null
>(null);

/** The media a card shows: its own, or a plain repost's original's. */
export function shownMedia(post: PostView): MediaItemView[] {
  if (isPlainRepost(post)) return post.reposted_post?.media ?? [];
  return post.media;
}

export interface CardReadiness {
  /** Show the card rather than its skeleton. */
  ready: boolean;
  /** The card shows at least one picture, so its skeleton reserves a frame. */
  hasMedia: boolean;
  /** Each picture's status, by URL. */
  statusOf: (url: string) => CardImageStatus;
}

type Settled = "loaded" | "unavailable";

/** The URLs a card waits for, one string so an effect can depend on it. */
function urlsKeyOf(post: PostView): string {
  return shownMedia(post)
    .flatMap((item) =>
      item.s3_key_public === null ? [] : [mediaUrl(item.s3_key_public)],
    )
    .join("\n");
}

function splitUrls(urlsKey: string): string[] {
  return urlsKey === "" ? [] : urlsKey.split("\n");
}

/**
 * Load `url` into a detached image and settle it once `decode()` has: a
 * rejected decode of a picture that did load still counts as loaded, an
 * `error` as unavailable. Returns the cancel.
 */
function preload(url: string, settle: (status: Settled) => void): () => void {
  let done = false;
  const finish = (status: Settled): void => {
    if (done) return;
    done = true;
    settle(status);
  };
  const image = new Image();
  image.onerror = () => finish("unavailable");
  image.src = url;
  if (typeof image.decode === "function") {
    image.decode().then(
      () => finish("loaded"),
      () =>
        finish(
          image.complete && image.naturalWidth > 0 ? "loaded" : "unavailable",
        ),
    );
  } else {
    image.onload = () => finish("loaded");
  }
  return () => {
    done = true;
    image.onerror = null;
    image.onload = null;
  };
}

/**
 * Readiness for one card. `inWindow` is `usePrepareWindow`'s: nothing is
 * loaded, and the bound does not run, until it is true.
 */
export function useCardReady(post: PostView, inWindow: boolean): CardReadiness {
  const urlsKey = urlsKeyOf(post);
  const urls = splitUrls(urlsKey);
  const [settled, setSettled] = useState<ReadonlyMap<string, Settled>>(
    () => new Map(),
  );
  // The post this card was last revealed for: a revealed card never goes back
  // to its skeleton, and a different post in the same place starts again.
  const [revealedFor, setRevealedFor] = useState<number | null>(null);

  const pending = urls.filter((url) => !settled.has(url));
  const ready = revealedFor === post.id || pending.length === 0;
  if (ready && revealedFor !== post.id) setRevealedFor(post.id);

  // A revealed card's changed picture is prepared wherever the card is.
  const preparing = inWindow || revealedFor === post.id;
  const hasPending = pending.length > 0;

  // Read by the effects, so a picture settling does not restart the others.
  const settledRef = useRef(settled);
  settledRef.current = settled;

  useEffect(() => {
    if (!preparing) return;
    const cancels = splitUrls(urlsKey)
      .filter((url) => !settledRef.current.has(url))
      .map((url) =>
        preload(url, (status) =>
          setSettled((previous) => new Map(previous).set(url, status)),
        ),
      );
    return () => cancels.forEach((cancel) => cancel());
  }, [preparing, urlsKey]);

  useEffect(() => {
    if (!preparing || !hasPending) return;
    const timer = setTimeout(() => {
      setSettled((previous) => {
        const next = new Map(previous);
        for (const url of splitUrls(urlsKey)) {
          if (!next.has(url)) next.set(url, "unavailable");
        }
        return next;
      });
    }, CARD_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [preparing, hasPending, urlsKey]);

  const statusOf = useCallback(
    (url: string): CardImageStatus => settled.get(url) ?? "pending",
    [settled],
  );

  return { ready, hasMedia: shownMedia(post).length > 0, statusOf };
}

/**
 * Whether the element given to the returned ref is within the prepare window,
 * latched: once a card has started preparing, scrolling it away does not stop
 * it. Without `IntersectionObserver` every card counts as in the window.
 */
export function usePrepareWindow(): [
  (element: Element | null) => void,
  boolean,
] {
  const [inWindow, setInWindow] = useState(
    () => typeof window.IntersectionObserver === "undefined",
  );
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((element: Element | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (element === null || typeof window.IntersectionObserver === "undefined")
      return;
    const watching = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          watching.disconnect();
          setInWindow(true);
        }
      },
      { rootMargin: PREPARE_WINDOW_ROOT_MARGIN },
    );
    observer.current = watching;
    watching.observe(element);
  }, []);

  return [ref, inWindow];
}
