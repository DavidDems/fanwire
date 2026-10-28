/**
 * FRONTEND-024: keep the reusable quiet-state motif original, decorative and
 * local. Browser tests cover its rendered treatment in each owning state.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { moduleCssViolations } from "../../test/module-css";

const sourceRoot = existsSync(
  join(process.cwd(), "src/components/visuals/CourtScoreboard.tsx"),
)
  ? join(process.cwd(), "src")
  : join(process.cwd(), "frontend/src");
const component = readFileSync(
  join(sourceRoot, "components/visuals/CourtScoreboard.tsx"),
  "utf8",
);
const stylesheet = readFileSync(
  join(sourceRoot, "components/visuals/CourtScoreboard.module.css"),
  "utf8",
);

describe("the quiet-state court and scoreboard motif", () => {
  it("is an inline, hidden SVG with no external or focusable content", () => {
    expect(component).toMatch(/<svg\b/);
    expect(component).toMatch(/aria-hidden=["']true["']/);
    expect(component).not.toMatch(/<img\b|<a\b|href=|tabIndex|tabindex|fetch\s*\(/i);
    expect(component).not.toMatch(/https?:\/\//i);
  });

  it("uses semantic theme tokens and requests no external style assets", () => {
    expect(stylesheet).toContain("var(--color-border-strong)");
    expect(stylesheet).toContain("var(--color-surface)");
    expect(stylesheet).not.toMatch(/url\s*\(|@import/i);
    expect(moduleCssViolations(stylesheet)).toEqual([]);
  });
});
