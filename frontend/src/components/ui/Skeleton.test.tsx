/**
 * FRONTEND-015 criterion 4: the post skeleton reserves a post image's frame
 * when the card it stands in for has media.
 *
 * A prop on the one `post` variant, not a second variant: every card's
 * skeleton keeps the same `post` class (the same height rules), and a card
 * with pictures adds the 4:3 block its first picture will occupy, so the
 * reveal moves nothing. The frame's `aspect-ratio` is read from disk, because
 * jsdom applies no styles; the no-animation half is `ui-css.test.ts`'s.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { readSrcFile, stripComments } from "../../test/css";
import { Skeleton } from "./Skeleton";
import styles from "./Skeleton.module.css";

/**
 * The interface this unit gives `Skeleton`: an optional `media` flag on the
 * post variant. Typed here, so this file compiles before the prop exists and
 * fails on the assertions, not on the build.
 */
const PostSkeleton = Skeleton as (props: {
  variant: "post" | "line";
  media?: boolean;
}) => ReturnType<typeof Skeleton>;

describe("Skeleton post with media", () => {
  it("keeps the post variant's class, aria-hidden and text-free", () => {
    const { container } = render(<PostSkeleton variant="post" media />);

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass(styles.post);
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).toBe("");
  });

  it("adds a frame block that the plain post skeleton does not have", () => {
    const plain = render(<Skeleton variant="post" />).container;
    const plainBlocks = plain.querySelectorAll("*").length;
    const withMedia = render(<PostSkeleton variant="post" media />).container;

    expect(withMedia.querySelectorAll("*").length).toBeGreaterThan(plainBlocks);
  });

  it("renders the plain post skeleton unchanged when media is false", () => {
    const plain = render(<Skeleton variant="post" />).container.innerHTML;
    const explicit = render(<PostSkeleton variant="post" media={false} />)
      .container.innerHTML;

    expect(explicit).toBe(plain);
  });

  it("gives the frame a 4 / 3 aspect ratio in Skeleton.module.css", () => {
    const css = stripComments(readSrcFile("components/ui/Skeleton.module.css"));

    expect(css).toMatch(/aspect-ratio\s*:\s*4\s*\/\s*3\s*[;}]/);
  });
});
