/**
 * FRONTEND-031: the Seasons tab's team search shows each matching team with
 * its `TeamIcon` beside its name and abbreviation, which stay as text. The
 * icon is `aria-hidden` (the name is adjacent), so an option's accessible
 * name is unchanged.
 *
 * `TeamIcon` is replaced by a stand-in that renders no text and keeps the
 * real interface (see `components/stats-nav/team-icons.test.tsx`).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CELTICS, NETS, statsTeams } from "../../test/stats";
import { TeamSearch } from "./TeamSearch";

vi.mock("../../components/ui/TeamIcon", async () => {
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

function iconsIn(root: Element): string[] {
  return [...root.querySelectorAll("[data-team-icon]")].map(
    (icon) => icon.getAttribute("data-team-icon") ?? "",
  );
}

describe("the team search results (TeamSearch)", () => {
  it("shows each option's icon beside its name and abbreviation", async () => {
    const user = userEvent.setup();
    render(
      <TeamSearch
        teams={statsTeams()}
        selectedId={null}
        onChoose={() => {}}
        onClear={() => {}}
      />,
    );
    // "B" matches Boston (BOS) and Brooklyn (BKN), by name or abbreviation.
    await user.type(screen.getByRole("combobox", { name: "Team" }), "B");
    const listbox = screen.getByRole("listbox", { name: "Teams" });
    const options = within(listbox).getAllByRole("option");
    const teams = statsTeams().filter((team) =>
      options.some((option) => option.textContent?.includes(team.name)),
    );
    expect(teams.map((team) => team.abbreviation)).toEqual(
      expect.arrayContaining([CELTICS.abbreviation, NETS.abbreviation]),
    );

    for (const option of options) {
      const team = teams.find((t) => option.textContent?.includes(t.name));
      expect(team, "the option still names its team").toBeDefined();
      expect(option.textContent).toContain(team?.abbreviation);
      expect(iconsIn(option)).toEqual([team?.abbreviation]);
      expect(option.querySelector("[data-team-icon]")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
    // The accessible name is the text alone.
    expect(
      within(listbox).getByRole("option", { name: /^Boston Celtics\s+BOS$/ }),
    ).toBeInTheDocument();
  });
});
