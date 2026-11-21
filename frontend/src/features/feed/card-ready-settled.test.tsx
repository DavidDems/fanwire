/**
 * `useCardReady` keeps what has settled: when a card's pictures change, the
 * one already loaded is not prepared again, and only the new one is.
 *
 * FRONTEND-047 moved the write that keeps the effects' view of what has
 * settled out of render and into an effect (react-hooks 7's `refs` rule);
 * this pins what it must keep.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { stubImages } from "../../test/card-ready";
import { testMediaItem, testPostView } from "../../test/feed";
import type { PostView } from "./api";
import { mediaUrl } from "./api";
import { useCardReady } from "./useCardReady";

const KEY_X = "media/7101/full.jpg";
const KEY_Y = "media/7102/full.jpg";
const KEY_Z = "media/7103/full.jpg";

function twoPictures(first: string, second: string): PostView {
  return testPostView({
    id: 301,
    text: "Two pictures",
    media: [
      testMediaItem({ id: 1, s3_key_public: first }),
      testMediaItem({ id: 2, s3_key_public: second }),
    ],
  });
}

describe("useCardReady when a card's pictures change", () => {
  it("prepares only the new picture, not the one that already settled", async () => {
    const images = stubImages();
    const { result, rerender } = renderHook(
      ({ post }: { post: PostView }) => useCardReady(post, true),
      { initialProps: { post: twoPictures(KEY_X, KEY_Y) } },
    );
    await waitFor(() =>
      expect(images.wasRequested(mediaUrl(KEY_Y))).toBe(true),
    );

    await images.load(mediaUrl(KEY_X));
    await waitFor(() =>
      expect(result.current.statusOf(mediaUrl(KEY_X))).not.toBe("pending"),
    );
    expect(result.current.ready, "Y is still loading").toBe(false);
    const preparedX = images.requestCount(mediaUrl(KEY_X));

    act(() => rerender({ post: twoPictures(KEY_X, KEY_Z) }));

    await waitFor(() =>
      expect(images.wasRequested(mediaUrl(KEY_Z))).toBe(true),
    );
    expect(
      images.requestCount(mediaUrl(KEY_X)),
      "X had settled, so it is not prepared again",
    ).toBe(preparedX);

    await images.load(mediaUrl(KEY_Z));
    await waitFor(() => expect(result.current.ready).toBe(true));
  });
});
