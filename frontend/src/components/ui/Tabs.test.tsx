/**
 * FRONTEND-009 criterion 11 (and the tab half of criterion 2): the shared
 * `Tabs` component, `components/ui/Tabs.tsx`.
 *
 * The interface this file pins:
 *
 *     <Tabs label="Stats" items={[{ to: "/stats/seasons", label: "Seasons" }, …]} />
 *
 * renders a `<nav>` named by `label`, holding one link per item, in order,
 * each a router link to its `to` with its `label` as its accessible name. The
 * link of the current route carries `aria-current="page"`; the others carry
 * no `aria-current`.
 *
 * **Links that look like tabs, not an ARIA tablist** (brief, "Tabs are routes,
 * not state"). A `tablist` promises arrow-key switching between panels on one
 * page; these are separate pages with their own addresses. So there is no
 * `role="tab"`, `tablist` or `tabpanel` anywhere, and the component's own doc
 * comment says why, so a later unit does not "fix" it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";
import { moduleCssViolations } from "../../test/module-css";
import { Tabs } from "./Tabs";

const ITEMS = [
  { to: "/stats/seasons", label: "Seasons" },
  { to: "/stats/players", label: "Players" },
];

function renderTabs(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Tabs label="Stats" items={ITEMS} />
      <Routes>
        <Route path="/stats/seasons" element={<p>seasons view</p>} />
        <Route path="/stats/players" element={<p>players view</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function tabNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Stats" });
}

describe("Tabs", () => {
  it("is a nav named by its label, holding one link per item, in order", () => {
    renderTabs("/stats/seasons");

    const links = within(tabNav()).getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Seasons",
      "Players",
    ]);
    expect(links[0]).toHaveAttribute("href", "/stats/seasons");
    expect(links[1]).toHaveAttribute("href", "/stats/players");
  });

  it.each([
    ["/stats/seasons", "Seasons", "Players"],
    ["/stats/players", "Players", "Seasons"],
  ])(
    "at %s marks %s current with aria-current=page, and only it",
    (path, current, other) => {
      renderTabs(path);

      expect(
        within(tabNav()).getByRole("link", { name: current }),
      ).toHaveAttribute("aria-current", "page");
      expect(
        within(tabNav()).getByRole("link", { name: other }),
      ).not.toHaveAttribute("aria-current");
    },
  );

  it("moves aria-current when another tab is followed", async () => {
    renderTabs("/stats/seasons");
    const user = userEvent.setup();

    await user.click(within(tabNav()).getByRole("link", { name: "Players" }));

    expect(screen.getByText("players view")).toBeInTheDocument();
    expect(
      within(tabNav()).getByRole("link", { name: "Players" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(tabNav()).getByRole("link", { name: "Seasons" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("is links, not an ARIA tablist: no tab, tablist or tabpanel role", () => {
    const { container } = renderTabs("/stats/seasons");

    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(screen.queryAllByRole("tablist")).toEqual([]);
    expect(screen.queryAllByRole("tabpanel")).toEqual([]);
    expect(
      container.querySelectorAll('[role="tab"], [role="tablist"], [role="tabpanel"]'),
    ).toHaveLength(0);
  });

  it("is reachable with Tab, one stop per link", async () => {
    renderTabs("/stats/seasons");
    const user = userEvent.setup();

    await user.tab();
    expect(document.activeElement).toBe(
      within(tabNav()).getByRole("link", { name: "Seasons" }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      within(tabNav()).getByRole("link", { name: "Players" }),
    );
  });
});

describe("Tabs on disk", () => {
  const UI_DIR = join(SRC_DIR, "components", "ui");

  it("says in its doc comment why it is not a tablist", () => {
    const source = readFileSync(join(UI_DIR, "Tabs.tsx"), "utf8");
    const comments = (source.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) ?? []).join(
      "\n",
    );

    expect(comments).toMatch(/tablist|role="?tab"?/i);
  });

  it("has a stylesheet with only tokens, no px font sizes, and a visible focus", () => {
    const css = readFileSync(join(UI_DIR, "Tabs.module.css"), "utf8");

    expect(css.trim().length).toBeGreaterThan(0);
    expect(moduleCssViolations(css)).toEqual([]);
  });
});
