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
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
