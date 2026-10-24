/**
 * UI-010 criterion 5: `components/ui/SearchInput.tsx`, a search field with a
 * leading search icon.
 *
 * The interface this file pins:
 *
 *     <SearchInput id="team-q" label="Find a team" name="q" maxLength={40} />
 *
 * takes `{ id, label, error? }` plus every other prop of an `<input>`. It
 * renders FormField's `<Field id label error>` (the label above, the error
 * message below) around a wrapper that holds an aria-hidden `SearchIcon` and
 * an `<input type="search">` carrying `describeField(id, { error })` and the
 * remaining props.
 *
 * CSS (jsdom applies none, so it is read from disk): the icon sits inside the
 * fill (`position: absolute`), and the input's inline-start padding is more
 * than var(--space-4), so the text clears the icon. base.css styles every
 * input with `input:not([type="checkbox"], [type="radio"], [type="file"])`
 * (specificity 0,1,1) and comes *after* the module CSS in the built bundle
 * (`main.tsx` imports App before the global stylesheets), so the module rule
 * that sets that padding must be more specific than 0,1,1 to win.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ChangeEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  SRC_DIR,
  allBlocks,
  isAtRule,
  normaliseValue,
  parseCss,
  selectors,
  type CssBlock,
} from "../../test/css";
import { declared, moduleCssViolations } from "../../test/module-css";
import { SearchInput } from "./SearchInput";

describe("SearchInput", () => {
  it("is a search box named by its label", () => {
    render(<SearchInput id="team-q" label="Find a team" />);

    const box = screen.getByRole("searchbox", { name: "Find a team" });
    expect(box.tagName).toBe("INPUT");
    expect(box).toHaveAttribute("type", "search");
    expect(box).toHaveAttribute("id", "team-q");
    expect(screen.getByLabelText("Find a team")).toBe(box);
  });

  it("puts the label above the field, outside the icon's wrapper", () => {
    const { container } = render(
      <SearchInput id="team-q" label="Find a team" />,
    );

    const label = container.querySelector("label") as HTMLLabelElement;
    const box = screen.getByRole("searchbox", { name: "Find a team" });
    expect(label).toHaveAttribute("for", "team-q");
    expect(
      label.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(box.parentElement).not.toContainElement(label);
  });

  it("leads with an aria-hidden search icon inside the input's wrapper", () => {
    render(<SearchInput id="team-q" label="Find a team" />);

    const box = screen.getByRole("searchbox", { name: "Find a team" });
    const wrapper = box.parentElement as HTMLElement;
    const icons = wrapper.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute("aria-hidden", "true");
    expect(
      icons[0].compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the icon comes before the input",
    ).toBeTruthy();
  });

  it("adds nothing to the box's accessible name", () => {
    render(<SearchInput id="team-q" label="Find a team" />);

    expect(
      screen.getByRole("searchbox", { name: "Find a team" }),
    ).toHaveAccessibleName("Find a team");
  });

  it("passes the input's other props through", () => {
    render(
      <SearchInput
        id="team-q"
        label="Find a team"
        name="q"
        maxLength={40}
        placeholder="Raptors"
        autoComplete="off"
        disabled
      />,
    );

    const box = screen.getByRole("searchbox", { name: "Find a team" });
    expect(box).toHaveAttribute("name", "q");
    expect(box).toHaveAttribute("maxLength", "40");
    expect(box).toHaveAttribute("placeholder", "Raptors");
    expect(box).toHaveAttribute("autocomplete", "off");
    expect(box).toBeDisabled();
  });

  it("is controlled through value and onChange", async () => {
    const seen = vi.fn();
    function Controlled() {
      const [text, setText] = useState("rap");
      return (
        <SearchInput
          id="team-q"
          label="Find a team"
          value={text}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            seen(event.target.value);
            setText(event.target.value);
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole("searchbox", { name: "Find a team" });

    expect(box).toHaveValue("rap");
    await user.type(box, "s");

    expect(box).toHaveValue("raps");
    expect(seen).toHaveBeenLastCalledWith("raps");
  });

  it("has no error state without an error", () => {
    render(<SearchInput id="team-q" label="Find a team" />);

    const box = screen.getByRole("searchbox", { name: "Find a team" });
    expect(box).not.toHaveAttribute("aria-invalid");
    expect(box).not.toHaveAttribute("aria-describedby");
  });

  it("marks the box invalid and describes it by the error message", () => {
    render(
      <SearchInput id="team-q" label="Find a team" error="Type a name." />,
    );

    const box = screen.getByRole("searchbox", { name: "Find a team" });
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAttribute("aria-describedby", "team-q-error");
    expect(document.getElementById("team-q-error")).toHaveTextContent(
      "Type a name.",
    );
    expect(box).toHaveAccessibleDescription("Type a name.");
  });
});

/** Specificity as [ids, classes + attributes + pseudo-classes, types]. */
function specificity(raw: string): [number, number, number] {
  // :where() counts nothing; :not(), :is() and :has() count only their
  // argument, which the attribute and class counts below already see.
  const selector = raw.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (selector.match(/\.[\w-]+/g) ?? []).length +
    (selector.match(/\[[^\]]*\]/g) ?? []).length +
    (selector.match(/(?<!:):(?!:)(?!(not|is|has)\()[\w-]+/g) ?? []).length;
  const types = (
    selector
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\([^)]*\)/g, "")
      .match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []
  ).length;
  return [ids, classes, types];
}

function moreSpecificThan(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

/** Splits a value on top-level spaces, so `calc(a + b)` stays one part. */
function parts(value: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value.trim()) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (/\s/.test(character) && depth === 0) {
      if (current !== "") found.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current !== "") found.push(current);
  return found;
}

/** The inline-start padding a rule sets, from the shorthands or the longhands, last wins. */
function inlineStart(rule: CssBlock): string | undefined {
  let start: string | undefined;
  for (const { property, value } of rule.declarations) {
    const values = parts(value);
    if (property === "padding") start = values[3] ?? values[1] ?? values[0];
    else if (property === "padding-inline") start = values[0];
    else if (property === "padding-inline-start" || property === "padding-left")
      start = value;
  }
  return start === undefined ? undefined : normaliseValue(start);
}

describe("specificity (the reader the padding check uses)", () => {
  it.each([
    [".input", [0, 1, 0]],
    [".wrapper .input", [0, 2, 0]],
    [".wrapper input", [0, 1, 1]],
    ["input:not([type])", [0, 1, 1]],
    [":where(.wrapper) .input", [0, 1, 0]],
    [".wrapper .input:focus", [0, 3, 0]],
    [".field input[type='search']", [0, 2, 1]],
  ] as [string, [number, number, number]][])("%s is %j", (selector, value) => {
    expect(specificity(selector)).toEqual(value);
  });
});

describe("SearchInput.module.css", () => {
  const FILE = join(SRC_DIR, "components", "ui", "SearchInput.module.css");

  function rules(): CssBlock[] {
    return allBlocks(parseCss(readFileSync(FILE, "utf8"))).filter(
      (block) => !isAtRule(block),
    );
  }

  it("uses only tokens, no px font sizes, and keeps a visible focus", () => {
    const css = readFileSync(FILE, "utf8");

    expect(css.trim().length).toBeGreaterThan(0);
    expect(moduleCssViolations(css)).toEqual([]);
  });

  it("places the icon inside the field (position: absolute)", () => {
    expect(
      rules().some((rule) => declared(rule, "position") === "absolute"),
    ).toBe(true);
  });

  it("pads the text past the icon, in a rule that beats base.css's input rule", () => {
    const BASE_INPUT: [number, number, number] = [0, 1, 1];

    const padded = rules().filter((rule) => {
      const start = inlineStart(rule);
      return (
        start !== undefined &&
        start !== "var(--space-4)" &&
        !/^0(px|rem)?$/.test(start) &&
        !/^var\(--space-[1-3]\)$/.test(start)
      );
    });
    expect(
      padded.map((rule) => rule.prelude),
      "a rule setting padding-inline-start (or padding-left) past the icon",
    ).not.toEqual([]);
    expect(
      padded.some((rule) =>
        selectors(rule).every((selector) =>
          moreSpecificThan(specificity(selector), BASE_INPUT),
        ),
      ),
      `${padded.map((rule) => rule.prelude).join(", ")} must be more specific than 0,1,1 to beat base.css`,
    ).toBe(true);
  });
});
