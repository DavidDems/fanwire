/**
 * FRONTEND-015 criterion 1, from search results: a result's card follows the
 * same readiness rule as the feed's, through the same wrapper. It is the
 * shared skeleton until its picture is ready, then the whole card; a result
 * without pictures is there at once.
 *
 * Through the real route table, like `search-thread.test.tsx`; the pictures
 * and the window are `src/test/card-ready.ts`'s stubs.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import skeletonStyles from "../../components/ui/Skeleton.module.css";
import { renderAppAt } from "../../test/app-route";
import { stubImages, stubIntersectionObserver } from "../../test/card-ready";
import { testMediaItem, testPostView } from "../../test/feed";
import {
  accountsPage,
  accountsStub,
  postsPage,
  postsStub,
} from "../../test/search";
import { mediaUrl } from "../feed/api";

const IMAGE_TEXT = "Raptors close it out";
const PLAIN_TEXT = "No picture on this one";
const KEY = "media/8001/full.jpg";

const WITH_IMAGE = testPostView({
  id: 801,
  text: IMAGE_TEXT,
  media: [testMediaItem({ id: 8001, s3_key_public: KEY })],
});
const PLAIN = testPostView({ id: 802, text: PLAIN_TEXT });

/** The list items of the Posts section, once its first page has arrived. */
async function resultItems(count: number): Promise<HTMLElement[]> {
  let items: HTMLElement[] = [];
  await waitFor(() => {
    const section = screen
      .getByRole("heading", { level: 2, name: "Posts" })
      .closest("section");
    const stream = section?.querySelector("ol");
    items = stream
      ? [...stream.querySelectorAll<HTMLElement>(":scope > li")]
      : [];
    expect(items).toHaveLength(count);
  });
  return items;
}

describe("a search result is prepared before it is shown", () => {
  it("is the shared skeleton until its picture is ready, then the whole card", async () => {
    const images = stubImages();
    stubIntersectionObserver({ intersectAll: true });
    renderAppAt("/search?q=raptors", "anonymous", [
      accountsStub({ 0: accountsPage([], null) }).handler,
      postsStub({ 0: postsPage([WITH_IMAGE, PLAIN], null) }).handler,
    ]);

    const [image, plain] = await resultItems(2);
    expect(image.querySelector(`.${skeletonStyles.post}`)).not.toBeNull();
    expect(image.querySelector("article")).toBeNull();
    expect(image.textContent).toBe("");
    expect(within(plain).getByText(PLAIN_TEXT)).toBeInTheDocument();

    await images.load(mediaUrl(KEY));

    expect(image.querySelector(`.${skeletonStyles.post}`)).toBeNull();
    expect(within(image).getByText(IMAGE_TEXT)).toBeInTheDocument();
    expect(
      [...image.querySelectorAll("img")].map((img) => img.getAttribute("src")),
    ).toEqual([mediaUrl(KEY)]);
  });
});
