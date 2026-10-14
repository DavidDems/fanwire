/**
 * UI-002 criterion 6: GameScore renders home score, an en dash (U+2013) and the
 * away score, in that order, labelled with the words Home and Away (the view
 * carries no team names). The game-state table in `components.md` §4 holds for
 * every listed code, and a code it does not know is shown as given and is never
 * called Live (accessibility.md A7; verification.md §2b).
 *
 * Props mirror `LiveScoreView` (`home_score`, `away_score`, `status`) in
 * camelCase; `variant` is `compact` (feed ticker) or `row` (search results).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { GameScore } from "./GameScore";

const EN_DASH = String.fromCodePoint(0x2013);

/**
 * The rendered text, with a space between text nodes: `textContent` would glue
 * "Q3" in one element to "Home" in the next into "Q3Home".
 */
function text(container: HTMLElement): string {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    parts.push(node.textContent ?? "");
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** "Live" as a word, so "Live score" elsewhere would still count — there is none here. */
const LIVE_WORD = /\bLive\b/;

describe("GameScore figures", () => {
  it.each(["compact", "row"] as const)(
    "variant %s renders Home, home score, en dash, away score, Away — in that order",
    (variant) => {
      const { container } = render(
        <GameScore
          variant={variant}
          homeScore={95}
          awayScore={99}
          status="Q3"
        />,
      );

      expect(text(container)).toMatch(
        new RegExp(`Home\\D*95\\s*${EN_DASH}\\s*99\\D*Away`),
      );
    },
  );

  it("keeps home first even when the away score is larger and longer", () => {
    const { container } = render(
      <GameScore variant="compact" homeScore={7} awayScore={112} status="FT" />,
    );

    const shown = text(container);
    expect(shown).toMatch(new RegExp(`Home\\D*7\\s*${EN_DASH}\\s*112\\D*Away`));
    expect(shown.indexOf("Home")).toBeLessThan(shown.indexOf("Away"));
  });

  it("uses an en dash, not a hyphen-minus, between the scores", () => {
    const { container } = render(
      <GameScore variant="compact" homeScore={1} awayScore={2} status="FT" />,
    );

    expect(text(container)).not.toMatch(/1\s*-\s*2/);
    expect(text(container)).toContain(EN_DASH);
  });
});

describe("game state mapping (components.md §4)", () => {
  it.each(["Q1", "Q2", "Q3", "Q4", "OT", "BT", "HT"])(
    "%s is live: a Live badge and the code itself",
    (status) => {
      const { container, getByText } = render(
        <GameScore
          variant="compact"
          homeScore={10}
          awayScore={12}
          status={status}
        />,
      );

      expect(getByText("Live")).toBeInTheDocument();
      expect(text(container)).toMatch(new RegExp(`\\b${status}\\b`));
      expect(text(container)).not.toMatch(/\bFinal\b/);
    },
  );

  it.each([
    ["FT", "Final"],
    ["AOT", "Final (OT)"],
    ["NS", "Scheduled"],
    ["POST", "Postponed"],
    ["CANC", "Cancelled"],
    ["SUSP", "Suspended"],
    ["AWD", "Awarded"],
    ["ABD", "Abandoned"],
  ])("%s is not live and is shown as %s", (status, shown) => {
    const { container } = render(
      <GameScore
        variant="compact"
        homeScore={10}
        awayScore={12}
        status={status}
      />,
    );

    expect(text(container)).toContain(shown);
    expect(text(container)).not.toMatch(LIVE_WORD);
  });

  it("FT is plain Final, without the overtime note", () => {
    const { container } = render(
      <GameScore variant="compact" homeScore={10} awayScore={12} status="FT" />,
    );

    expect(text(container)).not.toContain("(OT)");
  });

  it.each(["XYZ", "Q5", "LIVE?", "q3"])(
    "an unknown code %s is shown as given and is not called Live",
    (status) => {
      const { container } = render(
        <GameScore
          variant="compact"
          homeScore={10}
          awayScore={12}
          status={status}
        />,
      );

      expect(text(container)).toContain(status);
      expect(text(container).replace(status, "")).not.toMatch(LIVE_WORD);
      expect(text(container)).not.toMatch(/\bFinal\b/);
    },
  );
});

/**
 * FRONTEND-008 acceptance criterion 9: an optional link target.
 *
 * Pinned props, both optional so every existing caller still compiles:
 * `to` (a router path, e.g. `/games/501`) and `homeTeam` / `awayTeam` (the
 * teams' names, for the link's accessible name — the visible block still
 * says Home and Away). With `to`, the whole score block is one link whose
 * accessible name names both teams and both scores. Without it, nothing is a
 * link and the block renders as above.
 */
describe("GameScore with a link target", () => {
  /** The computed accessible name of `link`, as Testing Library computes it. */
  function accessibleName(link: HTMLElement): string {
    let computed = "";
    screen.getByRole("link", {
      name: (name, element) => {
        if (element === link) computed = name;
        return element === link;
      },
    });
    return computed;
  }

  function renderLinked() {
    return renderWithProviders(
      <GameScore
        variant="row"
        homeScore={117}
        awayScore={109}
        status="FT"
        to="/games/501"
        homeTeam="Toronto Raptors"
        awayTeam="Phoenix Suns"
      />,
    );
  }

  it("is one link to the target", () => {
    renderLinked();

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/games/501");
  });

  it("wraps the whole score block: state and both figures are inside it", () => {
    const { container } = renderLinked();
    const link = screen.getByRole("link");

    expect(text(link)).toBe(text(container));
    expect(text(link)).toMatch(
      new RegExp(`Final.*Home\\D*117\\s*${EN_DASH}\\s*109\\D*Away`),
    );
  });

  it("is named for both teams and the score", () => {
    renderLinked();
    const name = accessibleName(screen.getByRole("link"));

    expect(name).toContain("Toronto Raptors");
    expect(name).toContain("Phoenix Suns");
    expect(name).toMatch(/(?<!\d)117(?!\d)/);
    expect(name).toMatch(/(?<!\d)109(?!\d)/);
  });

  it.each(["compact", "row"] as const)(
    "variant %s without a target is not a link, team names or not",
    (variant) => {
      renderWithProviders(
        <GameScore
          variant={variant}
          homeScore={117}
          awayScore={109}
          status="FT"
          homeTeam="Toronto Raptors"
          awayTeam="Phoenix Suns"
        />,
      );

      expect(screen.queryAllByRole("link")).toEqual([]);
    },
  );
});
