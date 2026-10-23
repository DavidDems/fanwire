/**
 * FRONTEND-015 criterion 1, in the thread modal: the root's card and each
 * reply's card follow the feed's readiness rule, through the same wrapper.
 * Each is the shared skeleton until its own picture is ready, a card without
 * pictures is there at once, and the dialog itself is open meanwhile.
 *
 * A direct load of `/posts/<id>`, through the real route table; the pictures
 * and the window are `src/test/card-ready.ts`'s stubs.
 */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import skeletonStyles from "../../components/ui/Skeleton.module.css";
import { renderAppAt } from "../../test/app-route";
import { stubImages, stubIntersectionObserver } from "../../test/card-ready";
import {
  feedPage,
  feedStub,
  testAuthor,
  testMediaItem,
  testPostView,
  threadView,
} from "../../test/feed";
import { threadServer } from "../../test/thread";
import { mediaUrl } from "../feed/api";

const ROOT_TEXT = "Raptors in six";
const PICTURE_REPLY_TEXT = "Look at this block";
const PLAIN_REPLY_TEXT = "Barnes was everywhere";
const ROOT_KEY = "media/9001/full.jpg";
const REPLY_KEY = "media/9002/full.jpg";

const ROOT = testPostView({
  id: 101,
  text: ROOT_TEXT,
  reply_count: 2,
  media: [testMediaItem({ id: 9001, s3_key_public: ROOT_KEY })],
});
const PICTURE_REPLY = testPostView({
  id: 111,
  text: PICTURE_REPLY_TEXT,
  is_reply: true,
  parent_post_id: 101,
  author: testAuthor({ id: 12, username: "bench12" }),
  created_at: "2026-09-28T12:05:00Z",
  media: [testMediaItem({ id: 9002, s3_key_public: REPLY_KEY })],
});
const PLAIN_REPLY = testPostView({
  id: 112,
  text: PLAIN_REPLY_TEXT,
  is_reply: true,
  parent_post_id: 101,
  author: testAuthor({ id: 13, username: "wing13" }),
  created_at: "2026-09-28T12:10:00Z",
});

function skeletonCount(root: HTMLElement): number {
  return root.querySelectorAll(`.${skeletonStyles.post}`).length;
}

describe("a thread's cards are prepared before they are shown", () => {
  it("keeps the root and a picture reply as skeletons until each is ready, and shows a plain reply at once", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    renderAppAt("/posts/101", "anonymous", [
      feedStub([feedPage([], null)]).handler,
      threadServer([threadView(ROOT, [PICTURE_REPLY, PLAIN_REPLY])]).handler,
    ]);

    const dialog = await screen.findByRole("dialog", { name: "Thread" });
    expect(
      await within(dialog).findByText(PLAIN_REPLY_TEXT),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(ROOT_TEXT), "the root waits").toBeNull();
    expect(
      within(dialog).queryByText(PICTURE_REPLY_TEXT),
      "the reply waits",
    ).toBeNull();
    expect(skeletonCount(dialog)).toBe(2);

    await images.load(mediaUrl(REPLY_KEY));
    expect(within(dialog).getByText(PICTURE_REPLY_TEXT)).toBeInTheDocument();
    expect(within(dialog).queryByText(ROOT_TEXT)).toBeNull();
    expect(skeletonCount(dialog)).toBe(1);

    await images.load(mediaUrl(ROOT_KEY));
    expect(within(dialog).getByText(ROOT_TEXT)).toBeInTheDocument();
    expect(skeletonCount(dialog)).toBe(0);
  });
});
