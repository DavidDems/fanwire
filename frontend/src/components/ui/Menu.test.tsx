/**
 * FRONTEND-012 criteria 1 and 14 — the shared `Menu` (`components.md` §2: "use
 * the Popover API before considering a dependency").
 *
 * A button and a list of actions, and the keyboard a menu owes its reader:
 *
 * - **The button** is named by `label` and says what it opens and whether it
 *   is open: `aria-haspopup` (`"menu"` or `"true"`, the same thing) and
 *   `aria-expanded`.
 * - **The list** is a `popover` element with `role="menu"`, its items
 *   `role="menuitem"` in the order given. Opening it moves focus to the first
 *   item; ArrowDown and ArrowUp move between items.
 * - **Escape closes the menu and nothing else.** It returns focus to the button,
 *   is stopped at the menu (a parent's own keydown handler never sees it) and
 *   is default-prevented — the default of an Escape is what closes a `<dialog>`
 *   around the menu, and the thread modal is one (`FRONTEND-010`).
 * - **Tab leaves it**: focus goes on, and the menu closes behind it.
 * - **Choosing an item** calls its `onSelect` once and closes the menu. A
 *   disabled item ("Reported") is announced as disabled and does nothing.
 *
 * jsdom implements no Popover API (no `showPopover`), so nothing here asserts
 * how the list is shown or hidden — only the state a reader is told about and
 * where focus is. Light dismiss and the top layer are browser rows
 * (`verification.md`). The module CSS is checked by the same scanner every
 * other `components/ui` module is.
 *
 * The interface pinned: `Menu({ label, items, icon? })` from `./Menu`, each
 * item `{ label, onSelect, disabled? }` (`MenuItem`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SRC_DIR } from "../../test/css";
import { moduleCssViolations } from "../../test/module-css";
import { Menu, type MenuItem } from "./Menu";

function renderMenu(items?: MenuItem[]) {
  const onCopy = vi.fn();
  const onReport = vi.fn();
  const onDelete = vi.fn();
  const parentKeyDown = vi.fn();
  const given: MenuItem[] = items ?? [
    { label: "Copy link", onSelect: onCopy },
    { label: "Report", onSelect: onReport },
    { label: "Delete", onSelect: onDelete },
  ];
  render(
    <div onKeyDown={(event) => parentKeyDown(event.key)}>
      <button type="button">Before</button>
      <Menu label="More options" items={given} />
      <button type="button">After</button>
    </div>,
  );
  return {
    onCopy,
    onReport,
    onDelete,
    parentKeyDown,
    button: screen.getByRole("button", { name: "More options" }),
  };
}

async function opened(items?: MenuItem[]) {
  const user = userEvent.setup();
  const rendered = renderMenu(items);
  await user.click(rendered.button);
  const menu = await screen.findByRole("menu");
  return {
    ...rendered,
    user,
    menu,
    items: within(menu).getAllByRole("menuitem"),
  };
}

describe("the menu button", () => {
  it("is a button named by its label, saying it opens a menu and is closed", () => {
    const { button } = renderMenu();

    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-haspopup")).toMatch(/^(menu|true)$/);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the menu on a click, and says so", async () => {
    const { button, menu } = await opened();

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(menu).toBeInTheDocument();
  });

  it("opens from the keyboard too (Enter on the focused button)", async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();

    button.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(button).toHaveAttribute("aria-expanded", "true"),
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on a second click", async () => {
    const { user, button } = await opened();

    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

describe("the open menu", () => {
  it("is a popover element with role menu, its items menuitems in the order given", async () => {
    const { menu, items } = await opened();

    expect(menu).toHaveAttribute("popover");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Copy link",
      "Report",
      "Delete",
    ]);
  });

  it("moves focus to the first item", async () => {
    const { items } = await opened();

    await waitFor(() => expect(items[0]).toHaveFocus());
  });

  it("moves between items with ArrowDown and ArrowUp", async () => {
    const { user, items } = await opened();
    await waitFor(() => expect(items[0]).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[2]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(items[1]).toHaveFocus();
  });

  it("keeps only one tab stop in the list (the arrows move, not Tab)", async () => {
    const { items } = await opened();

    // A roving list: every item but the focused one is out of the tab order.
    const tabbable = items.filter((item) => item.tabIndex >= 0);
    expect(tabbable.length).toBeLessThanOrEqual(1);
  });
});

describe("Escape closes the menu, and only the menu", () => {
  it("closes it and returns focus to the button", async () => {
    const { user, button, items } = await opened();
    await waitFor(() => expect(items[0]).toHaveFocus());

    await user.keyboard("{Escape}");

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("is default-prevented, so a <dialog> around the menu does not close too", async () => {
    const { items } = await opened();
    await waitFor(() => expect(items[0]).toHaveFocus());

    // `fireEvent` answers false when a handler called preventDefault().
    const notPrevented = fireEvent.keyDown(items[0], { key: "Escape" });

    expect(notPrevented).toBe(false);
  });

  it("is stopped at the menu: a parent's keydown handler never sees it", async () => {
    const { user, items, parentKeyDown } = await opened();
    await waitFor(() => expect(items[0]).toHaveFocus());

    await user.keyboard("{Escape}");

    expect(parentKeyDown).not.toHaveBeenCalledWith("Escape");
  });

  it("leaves the parent's other keys alone while closed", async () => {
    const user = userEvent.setup();
    const { button, parentKeyDown } = renderMenu();

    button.focus();
    await user.keyboard("{Escape}");

    // Closed, the menu has nothing to close: the Escape is not the menu's.
    expect(parentKeyDown).toHaveBeenCalledWith("Escape");
  });
});

describe("Tab leaves the menu", () => {
  it("moves focus on, out of the menu, and the menu closes behind it", async () => {
    const { user, button, menu, items } = await opened();
    await waitFor(() => expect(items[0]).toHaveFocus());

    await user.tab();

    expect(menu.contains(document.activeElement)).toBe(false);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

describe("choosing an item", () => {
  it("calls that item's onSelect once, on a click, and closes the menu", async () => {
    const { user, button, items, onReport, onCopy, onDelete } = await opened();

    await user.click(items[1]);

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("calls it from the keyboard (Enter on the focused item)", async () => {
    const { user, items, onCopy, onReport } = await opened();
    await waitFor(() => expect(items[0]).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("a disabled item is announced as disabled and does nothing", async () => {
    const onReported = vi.fn();
    const { user, items } = await opened([
      { label: "Copy link", onSelect: vi.fn() },
      { label: "Reported", onSelect: onReported, disabled: true },
    ]);

    const reported = items[1];
    expect(
      reported.hasAttribute("disabled") ||
        reported.getAttribute("aria-disabled") === "true",
    ).toBe(true);

    await user.click(reported);

    expect(onReported).not.toHaveBeenCalled();
  });
});

describe("Menu.module.css", () => {
  const path = join(SRC_DIR, "components", "ui", "Menu.module.css");

  it("exists beside the component", () => {
    expect(existsSync(path), path).toBe(true);
  });

  it("uses only tokens, no px font sizes, and keeps a visible focus", () => {
    const css = existsSync(path) ? readFileSync(path, "utf8") : "";

    expect(moduleCssViolations(css)).toEqual([]);
  });
});
