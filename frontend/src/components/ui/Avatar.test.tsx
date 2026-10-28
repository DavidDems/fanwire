import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "./Avatar";

const AVATAR_KEYS = [
  "court-lines",
  "ball-seams",
  "shot-clock",
  "scoreboard",
  "arc",
  "net-grid",
  "baseline",
  "play-pattern",
] as const;

describe("Avatar", () => {
  it("keeps the username initial as the null-key default", () => {
    const { container } = render(
      <Avatar username="fanwire" size="sm" avatarKey={null} />,
    );

    expect(container.querySelector("[aria-hidden='true']")).toHaveTextContent("f");
  });

  it.each(AVATAR_KEYS)("renders the original %s treatment", (avatarKey) => {
    const { container } = render(
      <Avatar username="fanwire" size="lg" avatarKey={avatarKey} />,
    );

    const art = container.querySelector(`[data-avatar-key='${avatarKey}']`);
    expect(art).toBeInTheDocument();
    expect(art).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("f")).toBeNull();
  });
});
