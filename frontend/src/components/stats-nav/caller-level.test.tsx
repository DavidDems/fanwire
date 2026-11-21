/**
 * A level the caller draws (`levelViews.view`): its controls open and replace
 * levels as the navigator's own do, and focus follows the same rule. Opening
 * a level moves focus to its heading; swapping the top level moves none.
 *
 * FRONTEND-047 renders the caller's view as a component of its own (react-hooks
 * 7's `refs` rule); these pin what it must keep.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { StatsNavigator, type LevelViews } from "./StatsNavigator";
import type { StatsLevel, StatsNavAdapter } from "./types";

const adapter: StatsNavAdapter = {
  gameLink: (_gameId, children) => <span>{children}</span>,
  playerLink: (_playerId, children) => <span>{children}</span>,
};

const views: LevelViews = {
  name: (level) =>
    level.kind === "record"
      ? `Record ${level.id}`
      : level.kind === "records"
        ? `Records, ${level.group ?? "all"}`
        : null,
  view: (level, { open, replace }) =>
    level.kind === "records" ? (
      <>
        <button
          type="button"
          onClick={() => open({ kind: "record", id: "most-points" })}
        >
          Open most points
        </button>
        <button
          type="button"
          onClick={() => replace({ kind: "records", group: "top" })}
        >
          Top records
        </button>
      </>
    ) : (
      <p>The record&apos;s view</p>
    ),
};

function Harness() {
  const [stack, setStack] = useState<StatsLevel[]>([
    { kind: "records", group: null },
  ]);
  return (
    <StatsNavigator
      stack={stack}
      adapter={adapter}
      levelViews={views}
      open={(level) => setStack((current) => [...current, level])}
      replace={(level) =>
        setStack((current) => [...current.slice(0, -1), level])
      }
      pop={(toDepth) => setStack((current) => current.slice(0, toDepth))}
    />
  );
}

function focusedHeading(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active === null || !/^H[1-6]$/.test(active.tagName)) return null;
  return active;
}

describe("a level the caller draws", () => {
  it("shows the caller's view under the caller's heading, moving no focus", () => {
    render(<Harness />);

    expect(
      screen.getByRole("heading", { name: "Records, all" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open most points" }),
    ).toBeInTheDocument();
    expect(focusedHeading()).toBeNull();
  });

  it("opens a level from its control, focus on the new level's heading", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Open most points" }));

    expect(await screen.findByText("The record's view")).toBeInTheDocument();
    await waitFor(() =>
      expect(focusedHeading()?.textContent).toBe("Record most-points"),
    );
  });

  it("swaps the top level from its control, moving no focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const top = screen.getByRole("button", { name: "Top records" });

    await user.click(top);

    expect(
      await screen.findByRole("heading", { name: "Records, top" }),
    ).toBeInTheDocument();
    expect(focusedHeading()).toBeNull();
  });
});
