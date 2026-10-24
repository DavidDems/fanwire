/**
 * UI-010 criterion 7: `components/ui/FloatingButton.tsx`, a 56 px circular
 * action fixed at the bottom right.
 *
 * The interface this file pins, a union on `to` / `onClick`:
 *
 *     <FloatingButton aria-label="New post" to="/compose">…</FloatingButton>
 *       → a react-router <Link>
 *     <FloatingButton aria-label="New post" onClick={open}>…</FloatingButton>
 *       → a <button type="button">
 *
 * `aria-label` is required by the props: the content is an icon, so the label
 * is the only accessible name it has. No caller in this unit (FRONTEND-020
 * mounts it).
 *
 * CSS (read from disk; jsdom applies none): `position: fixed`, 3.5rem square,
 * --radius-full, --color-action fill, --shadow-2. On phones the bottom offset
 * clears the bottom navigation bar (under var(--space-8) tall plus the safe
 * area, `routes/AppLayout.module.css`) as well as
 * env(safe-area-inset-bottom), so it is a calc() of the safe area plus more.
 * From 40em, where the nav moves into the header, it sits var(--space-5) from
 * the right and the bottom.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import {
  SRC_DIR,
  allBlocks,
  isAtRule,
  normaliseValue,
  parseCss,
  type CssBlock,
} from "../../test/css";
import { declared, moduleCssViolations } from "../../test/module-css";
import { FloatingButton } from "./FloatingButton";

describe("FloatingButton", () => {
  it("with `to`, is a link to it named by aria-label", () => {
    render(
      <MemoryRouter>
        <FloatingButton aria-label="New post" to="/compose">
          <span aria-hidden="true">+</span>
        </FloatingButton>
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "New post" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/compose");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("with `onClick`, is a type=button button named by aria-label that fires it", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <FloatingButton aria-label="New post" onClick={onClick}>
        <span aria-hidden="true">+</span>
      </FloatingButton>,
    );

    const button = screen.getByRole("button", { name: "New post" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(screen.queryByRole("link")).toBeNull();

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders its children inside", () => {
    render(
      <FloatingButton aria-label="New post" onClick={() => {}}>
        <svg aria-hidden="true" data-testid="icon" />
      </FloatingButton>,
    );

    expect(screen.getByRole("button", { name: "New post" })).toContainElement(
      screen.getByTestId("icon"),
    );
  });

  it("requires aria-label in its props (checked by the typecheck)", () => {
    type Props = ComponentProps<typeof FloatingButton>;
    // `false` here, if aria-label were optional or a plain string were not
    // required on every member of the union, fails `npm run typecheck`.
    const required: Props extends { "aria-label": string } ? true : false =
      true;

    expect(required).toBe(true);
  });
});

describe("FloatingButton.module.css", () => {
  const FILE = join(SRC_DIR, "components", "ui", "FloatingButton.module.css");

  function blocks(): CssBlock[] {
    return parseCss(readFileSync(FILE, "utf8"));
  }

  /** Top-level style rules: the phone layout, mobile-first. */
  function phoneRules(): CssBlock[] {
    return blocks().filter((block) => !isAtRule(block));
  }

  function value(rule: CssBlock, property: string): string {
    return normaliseValue(declared(rule, property) ?? "");
  }

  function fixedRule(): CssBlock {
    const fixed = phoneRules().filter(
      (rule) => value(rule, "position") === "fixed",
    );
    expect(
      fixed.length,
      "a top-level rule with position: fixed",
    ).toBeGreaterThan(0);
    return fixed[0];
  }

  it("uses only tokens, no px font sizes, and keeps a visible focus", () => {
    const css = readFileSync(FILE, "utf8");

    expect(css.trim().length).toBeGreaterThan(0);
    expect(moduleCssViolations(css)).toEqual([]);
  });

  it("is fixed, 3.5rem (56 px) square and round", () => {
    const rule = fixedRule();

    expect(value(rule, "width")).toBe("3.5rem");
    expect(value(rule, "height")).toBe("3.5rem");
    expect(value(rule, "border-radius")).toBe("var(--radius-full)");
  });

  it("is filled with --color-action and lifted by --shadow-2", () => {
    const rule = fixedRule();

    expect([
      value(rule, "background-color"),
      value(rule, "background"),
    ]).toContain("var(--color-action)");
    expect(value(rule, "box-shadow")).toBe("var(--shadow-2)");
  });

  it("on phones, sits above the bottom bar and clear of the safe area", () => {
    const bottom = value(fixedRule(), "bottom");

    expect(bottom).toMatch(/^calc\(/);
    expect(bottom).toContain("env(safe-area-inset-bottom");
    // More than the safe area alone: the bar's height is added to it.
    expect(bottom.replace(/env\(safe-area-inset-bottom[^)]*\)/, "")).toMatch(
      /var\(--[\w-]+\)|\d/,
    );
  });

  it("from 40em, sits var(--space-5) from the right and the bottom", () => {
    const wide = blocks()
      .filter(
        (block) =>
          /^@media\b/.test(block.prelude) &&
          /min-width\s*:\s*40em/.test(block.prelude),
      )
      .flatMap((media) => allBlocks(media.children))
      .filter((rule) => !isAtRule(rule));

    expect(
      wide.some(
        (rule) =>
          value(rule, "bottom") === "var(--space-5)" &&
          [value(rule, "right"), value(rule, "inset-inline-end")].includes(
            "var(--space-5)",
          ),
      ),
      "a @media (min-width: 40em) rule with right and bottom var(--space-5)",
    ).toBe(true);
  });
});
