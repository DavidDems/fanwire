/**
 * UI-002 criteria 7 and 8: Avatar, EmptyState and Skeleton.
 *
 * Avatar shows the username's first character as typed — never uppercased —
 * and is aria-hidden because the username is always beside it.
 * Skeleton is aria-hidden; its "no animation" half is the static check in
 * `ui-css.test.ts`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "./Avatar";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./Skeleton";

describe("Avatar", () => {
  it.each([
    ["david", "d"],
    ["Zed", "Z"],
    ["mARIA", "m"],
    ["7seas", "7"],
  ])("renders the first character of %s as typed (%s)", (username, initial) => {
    const { container } = render(<Avatar username={username} size="sm" />);

    expect(container.textContent).toBe(initial);
  });

  it.each(["sm", "lg"] as const)("size %s is aria-hidden", (size) => {
    const { container } = render(<Avatar username="david" size={size} />);

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveTextContent("d");
  });
});

describe("EmptyState", () => {
  it("renders its message as a paragraph", () => {
    render(<EmptyState>There is nothing here yet.</EmptyState>);

    expect(screen.getByText("There is nothing here yet.").tagName).toBe("P");
  });
});

describe("Skeleton", () => {
  it.each(["post", "line"] as const)(
    "variant %s is aria-hidden and has no text",
    (variant) => {
      const { container } = render(<Skeleton variant={variant} />);

      const root = container.firstElementChild as HTMLElement;
      expect(root).not.toBeNull();
      expect(root).toHaveAttribute("aria-hidden", "true");
      expect(container.textContent).toBe("");
    },
  );
});
