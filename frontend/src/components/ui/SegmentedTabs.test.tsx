/**
 * UI-010 criterion 6: `components/ui/SegmentedTabs.tsx`, an in-page tab bar.
 *
 * The interface this file pins:
 *
 *     <SegmentedTabs
 *       label="Conference"
 *       tabs={[{ id: "all", label: "All" }, …]}
 *       value="all"
 *       onChange={(id) => …}
 *     >
 *       {the selected panel's content}
 *     </SegmentedTabs>
 *
 * **This is an ARIA tablist, unlike `Tabs`.** `Tabs` is navigation (each tab
 * a route, `aria-current`); this switches content on one page. So: a
 * `tablist` named by `label`; one `<button type="button" role="tab">` per tab
 * with `aria-selected` and `aria-controls` pointing at the panel; one
 * `tabpanel` wrapping `children`, labelled by the selected tab; a roving
 * tabindex, so only the selected tab is in the Tab order; ArrowRight and
 * ArrowLeft (wrapping), Home and End move focus to the target tab and call
 * `onChange` with its id. It is controlled: the parent owns `value`.
 *
 * CSS (read from disk; jsdom applies none): each tab at least
 * var(--target-min) tall; the selected tab a pill filled with
 * var(--color-action) and var(--color-on-action) text; the others
 * var(--color-text-muted); the bar scrolls sideways inside itself instead of
 * wrapping, so the page never does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
import {
  declared,
  lastCompoundClasses,
  moduleCssViolations,
} from "../../test/module-css";
import { SegmentedTabs } from "./SegmentedTabs";

const TABS = [
  { id: "all", label: "All" },
  { id: "east", label: "East" },
  { id: "west", label: "West" },
];

/** A parent that owns the value, as a real caller does. */
function Controlled({
  initial = "all",
  onChange,
}: {
  initial?: string;
  onChange?: (id: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedTabs
      label="Conference"
      tabs={TABS}
      value={value}
      onChange={(id: string) => {
        onChange?.(id);
        setValue(id);
      }}
    >
      <p>{`panel for ${value}`}</p>
    </SegmentedTabs>
  );
}

function tablist(): HTMLElement {
  return screen.getByRole("tablist", { name: "Conference" });
}

function tab(name: string): HTMLElement {
  return within(tablist()).getByRole("tab", { name });
}

describe("SegmentedTabs", () => {
  it("is a tablist named by its label, one tab button per item, in order", () => {
    render(<Controlled />);

    const tabs = within(tablist()).getAllByRole("tab");
    expect(tabs.map((each) => each.textContent?.trim())).toEqual([
      "All",
      "East",
      "West",
    ]);
    for (const each of tabs) {
      expect(each.tagName).toBe("BUTTON");
      expect(each).toHaveAttribute("type", "button");
    }
  });

  it("marks the value's tab selected, and only it", () => {
    render(<Controlled initial="east" />);

    expect(tab("East")).toHaveAttribute("aria-selected", "true");
    expect(tab("All")).not.toHaveAttribute("aria-selected", "true");
    expect(tab("West")).not.toHaveAttribute("aria-selected", "true");
    expect(within(tablist()).getAllByRole("tab", { selected: true })).toEqual([
      tab("East"),
    ]);
  });

  it("puts only the selected tab in the Tab order (roving tabindex)", () => {
    render(<Controlled initial="east" />);

    expect(tab("East")).toHaveAttribute("tabindex", "0");
    expect(tab("All")).toHaveAttribute("tabindex", "-1");
    expect(tab("West")).toHaveAttribute("tabindex", "-1");
  });

  it("wraps children in one tabpanel, labelled by the selected tab, which every tab controls", () => {
    render(<Controlled initial="east" />);

    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);
    const panel = panels[0];
    expect(panel).toHaveTextContent("panel for east");
    expect(panel.id).not.toBe("");
    expect(tab("East").id).not.toBe("");
    expect(panel).toHaveAttribute("aria-labelledby", tab("East").id);
    expect(screen.getByRole("tabpanel", { name: "East" })).toBe(panel);
    for (const name of ["All", "East", "West"]) {
      expect(tab(name)).toHaveAttribute("aria-controls", panel.id);
    }
  });

  it("gives two bars on one page distinct ids", () => {
    const { container } = render(
      <>
        <Controlled />
        <SegmentedTabs
          label="Records"
          tabs={[
            { id: "all", label: "Historical" },
            { id: "east", label: "Seasonal" },
          ]}
          value="all"
          onChange={() => {}}
        >
          <p>records</p>
        </SegmentedTabs>
      </>,
    );

    const ids = [...container.querySelectorAll("[id]")].map(
      (element) => element.id,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("calls onChange with the clicked tab's id and follows the new value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);

    await user.click(tab("West"));

    expect(onChange).toHaveBeenCalledWith("west");
    expect(tab("West")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel for west");
  });

  it("is one Tab stop: Tab reaches the selected tab, and the next Tab leaves the bar", async () => {
    const user = userEvent.setup();
    render(<Controlled initial="east" />);

    await user.tab();
    expect(document.activeElement).toBe(tab("East"));

    await user.tab();
    expect(within(tablist()).queryAllByRole("tab")).not.toContain(
      document.activeElement,
    );
  });

  it.each([
    ["all", "{ArrowRight}", "east", "East"],
    ["east", "{ArrowRight}", "west", "West"],
    ["west", "{ArrowRight}", "all", "All"],
    ["east", "{ArrowLeft}", "all", "All"],
    ["all", "{ArrowLeft}", "west", "West"],
    ["west", "{Home}", "all", "All"],
    ["all", "{End}", "west", "West"],
  ])(
    "from %s, %s selects %s and moves focus to it",
    async (initial, key, target, name) => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Controlled initial={initial} onChange={onChange} />);

      await user.tab();
      await user.keyboard(key);

      expect(onChange).toHaveBeenLastCalledWith(target);
      expect(document.activeElement).toBe(tab(name));
      expect(tab(name)).toHaveAttribute("aria-selected", "true");
      expect(tab(name)).toHaveAttribute("tabindex", "0");
    },
  );
});

describe("SegmentedTabs.module.css", () => {
  const FILE = join(SRC_DIR, "components", "ui", "SegmentedTabs.module.css");
  const SELECTED = /\[aria-selected=(["']?)true\1\]/;

  function rules(): CssBlock[] {
    return allBlocks(parseCss(readFileSync(FILE, "utf8"))).filter(
      (block) => !isAtRule(block),
    );
  }

  function value(rule: CssBlock, property: string): string {
    return normaliseValue(declared(rule, property) ?? "");
  }

  function selectedRules(): CssBlock[] {
    return rules().filter((rule) =>
      selectors(rule).some((selector) => SELECTED.test(selector)),
    );
  }

  /** The class the selected-tab rule hangs on: the tab's own class. */
  function tabClasses(): string[] {
    return selectedRules().flatMap((rule) =>
      selectors(rule).flatMap(lastCompoundClasses),
    );
  }

  /** Rules on the tab class that are not about the selected state. */
  function plainTabRules(): CssBlock[] {
    const classes = tabClasses();
    return rules().filter((rule) =>
      selectors(rule).some(
        (selector) =>
          !SELECTED.test(selector) &&
          !selector.includes(":") &&
          lastCompoundClasses(selector).some((name) => classes.includes(name)),
      ),
    );
  }

  it("uses only tokens, no px font sizes, and keeps a visible focus", () => {
    const css = readFileSync(FILE, "utf8");

    expect(css.trim().length).toBeGreaterThan(0);
    expect(moduleCssViolations(css)).toEqual([]);
  });

  it("makes each tab at least var(--target-min) tall", () => {
    expect(
      rules().some((rule) => value(rule, "min-height") === "var(--target-min)"),
    ).toBe(true);
  });

  it('fills the selected tab ([aria-selected="true"]) with --color-action and --color-on-action text', () => {
    expect(
      selectedRules().some(
        (rule) =>
          [value(rule, "background-color"), value(rule, "background")].includes(
            "var(--color-action)",
          ) && value(rule, "color") === "var(--color-on-action)",
      ),
    ).toBe(true);
  });

  it("makes the selected tab a pill (--radius-full)", () => {
    expect(
      [...selectedRules(), ...plainTabRules()].some(
        (rule) => value(rule, "border-radius") === "var(--radius-full)",
      ),
    ).toBe(true);
  });

  it("gives the other tabs --color-text-muted", () => {
    expect(
      plainTabRules().some(
        (rule) => value(rule, "color") === "var(--color-text-muted)",
      ),
    ).toBe(true);
  });

  it("scrolls the bar sideways inside itself instead of wrapping", () => {
    const scrolling = rules().filter((rule) =>
      ["overflow-x", "overflow"].some(
        (property) =>
          /^auto(\s|$)/.test(value(rule, property)) ||
          value(rule, property) === "hidden auto",
      ),
    );
    expect(scrolling.length, "a rule with overflow-x: auto").toBeGreaterThan(0);
    for (const rule of scrolling) {
      expect(value(rule, "flex-wrap")).not.toBe("wrap");
      expect(value(rule, "flex-flow")).not.toMatch(/\bwrap\b/);
    }
  });
});
