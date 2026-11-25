/**
 * FRONTEND-055 — the profile header's follower count is singular at exactly
 * one: "1 follower", never "1 followers". "0 followers" and "N followers"
 * keep the plural, and "N following" has no singular form, so it never
 * changes.
 *
 * `ProfileSummary` is rendered directly with its three scalars, as
 * `profile-style.test.tsx` does. Each count is matched by exact, whole-text
 * `getByText` inside the header card, so "1 follower" cannot match
 * "1 followers"; and each count stays one text node, the whole text of its
 * `li` (`components.md`: text tests read stays one text node).
 */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { ProfileSummary } from "./ProfileSummary";

const USERNAME = "raptorsfan";

function renderCounts(
  followerCount: number,
  followingCount: number,
): HTMLElement {
  renderWithProviders(
    <ProfileSummary
      username={USERNAME}
      followerCount={followerCount}
      followingCount={followingCount}
    />,
  );
  const heading = screen.getByRole("heading", {
    level: 1,
    name: new RegExp(`^${USERNAME}$`),
  });
  const header = heading.closest("header");
  expect(header, "the h1 sits in the header card").not.toBeNull();
  return header as HTMLElement;
}

function expectOneTextNodeLi(element: HTMLElement, text: string): void {
  expect(element.tagName).toBe("LI");
  expect(element.childNodes).toHaveLength(1);
  expect(element.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  expect(element.textContent).toBe(text);
}

describe("ProfileSummary follower count", () => {
  it('reads "0 followers" at zero', () => {
    const header = renderCounts(0, 0);

    expectOneTextNodeLi(within(header).getByText("0 followers"), "0 followers");
  });

  it('reads "1 follower" at exactly one, never "1 followers"', () => {
    const header = renderCounts(1, 0);

    expectOneTextNodeLi(within(header).getByText("1 follower"), "1 follower");
    expect(screen.queryByText("1 followers")).toBeNull();
  });

  it('reads "2 followers" at two', () => {
    const header = renderCounts(2, 0);

    expectOneTextNodeLi(within(header).getByText("2 followers"), "2 followers");
  });
});

describe("ProfileSummary following count", () => {
  it('reads "1 following" at one: the word has no singular form', () => {
    const header = renderCounts(0, 1);

    expectOneTextNodeLi(within(header).getByText("1 following"), "1 following");
  });
});
