/**
 * FRONTEND-020, Baseline (e), found by the Director's browser rows: the
 * shared `Dialog` is centred in the viewport (`margin: auto`), so when the
 * composer grows (the image tile appears, a refusal line replaces it) the
 * whole dialog moves up by half the growth. At 360 wide that was a layout
 * shift of 0.16 with no input to excuse it.
 *
 * The compose dialog is therefore anchored at the top: its own stylesheet
 * (`ComposeModal.module.css`, since `components/ui/` is not this unit's)
 * gives the `<dialog>` that holds the composer a fixed top margin and an
 * `auto` bottom one, so new content grows the dialog downward and nothing
 * above it moves. Pinned statically, as jsdom applies no styles.
 */
import { describe, expect, it } from "vitest";

import { isAtRule, parseCss, readSrcFile, selectors } from "../test/css";

const STYLESHEET = "routes/ComposeModal.module.css";

/** The top and bottom margins one rule declares, longhand or shorthand. */
function margins(declarations: { property: string; value: string }[]): {
  top: string | null;
  bottom: string | null;
} {
  let top: string | null = null;
  let bottom: string | null = null;
  for (const { property, value } of declarations) {
    const parts = value.trim().split(/\s+/);
    if (property === "margin-top" || property === "margin-block-start")
      top = value.trim();
    else if (property === "margin-bottom" || property === "margin-block-end")
      bottom = value.trim();
    else if (property === "margin-block") {
      top = parts[0];
      bottom = parts[1] ?? parts[0];
    } else if (property === "margin") {
      top = parts[0];
      bottom = parts.length >= 3 ? parts[2] : parts[0];
    }
  }
  return { top, bottom };
}

describe("the compose dialog is anchored at the top (Baseline e)", () => {
  it("ComposeModal.tsx uses its own stylesheet", () => {
    expect(readSrcFile("routes/ComposeModal.tsx")).toMatch(
      /from\s+["']\.\/ComposeModal\.module\.css["']/,
    );
  });

  it("gives the dialog holding the composer a fixed top margin and an auto bottom one", () => {
    const rules = parseCss(readSrcFile(STYLESHEET)).filter(
      (block) =>
        !isAtRule(block) &&
        selectors(block).some(
          (selector) =>
            /\bdialog\b/.test(selector) && selector.includes(":has("),
        ),
    );
    expect(
      rules,
      "a rule for the <dialog> that :has() the composer",
    ).not.toEqual([]);

    const found = rules.map((rule) => margins(rule.declarations));
    expect(
      found.some(
        ({ top, bottom }) =>
          top !== null && top !== "auto" && top !== "0" && bottom === "auto",
      ),
      `margins found: ${JSON.stringify(found)}`,
    ).toBe(true);
  });
});
