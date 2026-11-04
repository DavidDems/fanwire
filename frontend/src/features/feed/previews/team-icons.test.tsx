/**
 * FRONTEND-031: the feed's preview cards show a team's `TeamIcon` beside
 * its name: both teams on a game preview, and the player's team on a
 * player's game preview. The names stay as text. A career preview names no
 * team, so it has no icon.
 *
 * `TeamIcon` is replaced by a stand-in that renders no text and keeps the
 * real interface (see `components/stats-nav/team-icons.test.tsx`).
 */
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithAuth } from "../../../test/auth";
import type { PostView } from "../../../test/feed";
import {
  gameFinalPreview,
  playerCareerPreview,
  playerGamePreview,
  postWithPreview,
} from "../../../test/previews";
import { PostNode } from "../PostNode";

vi.mock("../../../components/ui/TeamIcon", async () => {
  const { createElement } = await import("react");
  return {
    TeamIcon: ({
      abbreviation,
      size,
      label,
    }: {
      abbreviation: string | null | undefined;
      size: string;
      label?: string;
    }) =>
      createElement("span", {
        "data-team-icon": abbreviation ?? "",
        "data-size": size,
        ...(label === undefined
          ? { "aria-hidden": "true" }
          : { role: "img", "aria-label": label }),
      }),
  };
});

function renderCard(post: PostView): HTMLElement {
  renderWithAuth(<PostNode post={post} />);
  const article = document.querySelector<HTMLElement>("article");
  if (article === null) throw new Error("no card rendered");
  return article;
}

function iconsIn(root: Element): string[] {
  return [...root.querySelectorAll("[data-team-icon]")].map(
    (icon) => icon.getAttribute("data-team-icon") ?? "",
  );
}

/**
 * The text right before and right after `icon` in the card, in document
 * order, skipping whitespace-only text: an icon beside a name has the name
 * on one side of it.
 */
function besideText(card: Element, icon: Element): [string, string] {
  const walker = document.createTreeWalker(
    card,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let before = "";
  let after: string | null = null;
  let passed = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === icon) {
      passed = true;
      continue;
    }
    if (node.nodeType !== Node.TEXT_NODE || icon.contains(node)) continue;
    const text = (node.textContent ?? "").trim();
    if (text === "") continue;
    if (!passed) before = text;
    else {
      after = text;
      break;
    }
  }
  return [before, after ?? ""];
}

function isBeside(card: Element, icon: Element, name: string): boolean {
  const [before, after] = besideText(card, icon);
  return before.endsWith(name) || after.startsWith(name);
}

describe("a game preview (GamePreview)", () => {
  it("shows both teams' icons, each beside its name", async () => {
    const preview = gameFinalPreview();
    const card = renderCard(postWithPreview(preview));
    await waitFor(() =>
      expect(iconsIn(card)).toEqual(
        expect.arrayContaining([
          preview.away_team.abbreviation,
          preview.home_team.abbreviation,
        ]),
      ),
    );
    for (const team of [preview.away_team, preview.home_team]) {
      const icon = card.querySelector(
        `[data-team-icon="${team.abbreviation}"]`,
      ) as Element;
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(
        isBeside(card, icon, team.name),
        `${team.name} is beside its icon`,
      ).toBe(true);
    }
    expect(card.textContent).toContain(preview.away_team.name);
    expect(card.textContent).toContain(preview.home_team.name);
  });
});

describe("a player's game preview (PlayerGamePreview)", () => {
  it("shows the player's team's icon beside its name", async () => {
    const preview = playerGamePreview();
    const card = renderCard(postWithPreview(preview));
    let icon: Element | null = null;
    await waitFor(() => {
      icon = card.querySelector(
        `[data-team-icon="${preview.team.abbreviation}"]`,
      );
      expect(icon).not.toBeNull();
    });
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(isBeside(card, icon as unknown as Element, preview.team.name)).toBe(
      true,
    );
    expect(card.textContent).toContain(preview.opponent.name);
  });
});

describe("a career preview (PlayerCareerPreview)", () => {
  it("names no team, so shows no icon", async () => {
    const card = renderCard(postWithPreview(playerCareerPreview()));
    await waitFor(() => expect(card.textContent).toMatch(/LeBron/));
    expect(iconsIn(card)).toEqual([]);
  });
});
