/**
 * USERS-005: the avatar is the username's first character, as typed, on an
 * optional inner colour inside an optional ring of an outer colour.
 *
 * - No colours: exactly today's default (the module's own fill and text, no
 *   inline colour, no ring).
 * - Inner set: that palette token as the fill, with black text
 *   (`--team-outer-black`, the palette's own black, as on a TeamIcon), always.
 * - Outer set: a ring in that palette token. With no inner, the text keeps
 *   the default colour.
 * - A profile picture renders as before; the colours do not replace it.
 *
 * jsdom computes no stylesheet, so the colours are read off the element's
 * inline style, which is where the component puts them, by token name. The
 * contrast case reads the tokens' values from `styles/tokens.css` on disk.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { INNER_COLORS, OUTER_COLORS, paletteEntries } from "../../lib/teamColors";
import {
  contrastRatio,
  normaliseHex,
  parseCss,
  readSrcFile,
  resolveToken,
  rootCustomProperties,
} from "../../test/css";
import { Avatar } from "./Avatar";
import styles from "./Avatar.module.css";

const TEXT_ON_FILL = "var(--team-outer-black)";

function avatarIn(container: HTMLElement): HTMLElement {
  const avatar = container.querySelector<HTMLElement>("[aria-hidden='true']");
  expect(avatar, "the avatar").not.toBeNull();
  return avatar as HTMLElement;
}

describe("Avatar", () => {
  it("keeps today's exact default initials when neither colour is selected", () => {
    const { container } = render(
      <Avatar username="fanwire" size="sm" avatarInnerColor={null} avatarOuterColor={null} />,
    );
    const avatar = avatarIn(container);

    expect(avatar).toHaveTextContent("f");
    expect(avatar.className).toBe([styles.avatar, styles.sm].join(" "));
    expect(avatar.getAttribute("style")).toBeNull();
    expect(avatar).not.toHaveAttribute("data-avatar-key");
  });

  it("keeps the default when the colours are left out", () => {
    const { container } = render(<Avatar username="fanwire" size="lg" />);
    const avatar = avatarIn(container);

    expect(avatar.className).toBe([styles.avatar, styles.lg].join(" "));
    expect(avatar.getAttribute("style")).toBeNull();
  });

  it("renders the first Unicode code point as typed in both sizes", () => {
    for (const size of ["sm", "lg"] as const) {
      const { container, unmount } = render(
        <Avatar username="🧡Fanwire" size={size} avatarInnerColor="gold" avatarOuterColor="blue" />,
      );
      expect(avatarIn(container).textContent).toBe("🧡");
      unmount();
    }
  });

  it.each(paletteEntries(INNER_COLORS).map(({ key }) => key))(
    "inner %s: that token as the fill, with black text",
    (inner) => {
      const { container } = render(
        <Avatar username="fanwire" size="lg" avatarInnerColor={inner} avatarOuterColor={null} />,
      );
      const avatar = avatarIn(container);

      expect(avatar.style.backgroundColor).toBe(`var(--team-inner-${inner})`);
      expect(avatar.style.color).toBe(TEXT_ON_FILL);
      expect(avatar.style.borderColor).toBe("");
      expect(avatar).toHaveTextContent("f");
    },
  );

  it.each(paletteEntries(OUTER_COLORS).map(({ key }) => key))(
    "outer %s alone: a ring in that token, the text keeps its default colour",
    (outer) => {
      const { container } = render(
        <Avatar username="fanwire" size="sm" avatarInnerColor={null} avatarOuterColor={outer} />,
      );
      const avatar = avatarIn(container);

      expect(avatar.style.borderColor).toBe(`var(--team-outer-${outer})`);
      expect(avatar).toHaveClass(styles.ring);
      expect(avatar.style.backgroundColor).toBe("");
      expect(avatar.style.color).toBe("");
    },
  );

  it("both: the inner fill with black text inside the outer ring", () => {
    const { container } = render(
      <Avatar username="fanwire" size="lg" avatarInnerColor="gold" avatarOuterColor="forest" />,
    );
    const avatar = avatarIn(container);

    expect(avatar.style.backgroundColor).toBe("var(--team-inner-gold)");
    expect(avatar.style.color).toBe(TEXT_ON_FILL);
    expect(avatar.style.borderColor).toBe("var(--team-outer-forest)");
    expect(avatar).toHaveClass(styles.ring);
    expect(avatar).toHaveTextContent("f");
  });

  it.each(INNER_COLORS.map(({ key }) => key))(
    "black text on inner %s meets 4.5:1, unrounded",
    (inner) => {
      const tokens = rootCustomProperties(parseCss(readSrcFile("styles/tokens.css")));
      const text = normaliseHex(resolveToken("--team-outer-black", tokens, null));
      const fill = normaliseHex(resolveToken(`--team-inner-${inner}`, tokens, null));

      expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("keeps a profile picture rendered, unchanged, when colours are selected", () => {
    const { container } = render(
      <Avatar
        username="fanwire"
        size="sm"
        pictureKey="picture.webp"
        avatarInnerColor="red"
        avatarOuterColor="black"
      />,
    );
    const avatar = avatarIn(container);
    expect(avatar.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("picture.webp"),
    );
    expect(avatar).not.toHaveTextContent("f");
    expect(avatar.className).toBe([styles.avatar, styles.sm].join(" "));
    expect(avatar.getAttribute("style")).toBeNull();
  });
});
