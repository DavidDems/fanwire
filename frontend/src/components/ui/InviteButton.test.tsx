/**
 * FRONTEND-032: `components/ui/InviteButton.tsx`, the Invite button beside the
 * floating compose button. `AppLayout.test.tsx` pins where it is rendered and
 * for whom; this file pins the control itself.
 *
 * The interface this file pins: a named export taking no props.
 *
 *     <InviteButton />
 *       → a <button type="button"> whose visible text is "Invite", with an
 *         aria-hidden lucide `link` icon (`LinkIcon` from ./icons)
 *
 * - **Pressing it** writes `window.location.origin + "/"` to the clipboard,
 *   once: the site's root, the guest feed, whatever page the member is on and
 *   whatever query that page carries. Nothing goes to the network.
 * - **On success** the visible text reads "Copied" for 2 seconds (still
 *   "Copied" at 1999 ms, "Invite" again at 2000 ms), and a polite live region
 *   says "Link copied". A second press restarts the 2 seconds; unmounting
 *   leaves no timer running.
 * - **Clipboard missing or refusing**: an inline message shows the whole
 *   address as selectable text (a read-only field or plain text), the button
 *   still reads "Invite", nothing says the link was copied, and nothing throws.
 * - **Styles** (read from disk; jsdom applies none): a target at least
 *   `--target-min` (44 px) tall, a visible focus ring, and Button secondary's
 *   colours and edge (`--color-surface` fill, a solid `--color-border-strong`
 *   border, `--color-text`), so forced-colors mode keeps its edge as it keeps
 *   Button secondary's. Either by carrying Button's own classes or by declaring
 *   the same in `InviteButton.module.css`.
 *
 * jsdom has no clipboard: `stubClipboard` (`test/post-menu.ts`) puts one on
 * `navigator` per test and restores the old descriptor afterwards. It is called
 * after `userEvent.setup()`, which installs a clipboard of its own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cssModulesFrom,
  drawsIcon,
  minimumBoxInRem,
  textOf,
  type CssModules,
} from "../../test/compose-modal";
import {
  SRC_DIR,
  isAtRule,
  normaliseValue,
  parseCss,
  readSrcFile,
  selectors,
  type CssBlock,
} from "../../test/css";
import {
  lastCompoundClasses,
  moduleCssViolations,
} from "../../test/module-css";
import { stubClipboard } from "../../test/post-menu";
import buttonStyles from "./Button.module.css";
import { LinkIcon } from "./icons";
import { InviteButton } from "./InviteButton";

/** 44 px, `--target-min`. */
const TARGET_REM = 2.75;

/** Every CSS module beside the component, keyed by its path under `src/`. */
const MODULES: CssModules = cssModulesFrom(
  import.meta.glob("./*.module.css", { eager: true }),
  "components/ui",
);

const CSS_FILE = join(SRC_DIR, "components", "ui", "InviteButton.module.css");

/** The guest feed's address: this origin, then `/`, and nothing more. */
function guestFeed(): string {
  return `${window.location.origin}/`;
}

function invite(): HTMLElement {
  return screen.getByRole("button");
}

/** Every polite live region on the page: `role="status"` or `aria-live="polite"`. */
function politeRegions(): Element[] {
  return [
    ...document.querySelectorAll('[role="status"], [aria-live="polite"]'),
  ].filter((region) => region.getAttribute("aria-live") !== "off");
}

function announced(text: string): boolean {
  return politeRegions().some((region) => textOf(region).includes(text));
}

/** The address shown for copying by hand: a field's value or plain text. */
function shownAddress(): HTMLElement | null {
  return (
    screen.queryByDisplayValue(guestFeed()) ??
    screen.queryByText(guestFeed(), { exact: true })
  );
}

/** Let the clipboard's promise settle, with fake or real timers. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  consoleError.mockRestore();
  vi.useRealTimers();
});

describe("InviteButton: the control", () => {
  it('is a type="button" button whose visible text is Invite', () => {
    render(<InviteButton />);

    const button = invite();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(textOf(button)).toBe("Invite");
    expect(button).toHaveAccessibleName("Invite");
  });

  it("carries lucide's link icon, aria-hidden, from components/ui/icons", () => {
    render(<InviteButton />);

    expect(drawsIcon(invite(), LinkIcon)).toBe(true);
  });

  it("shows no address and announces nothing before it is pressed", () => {
    render(<InviteButton />);

    expect(shownAddress()).toBeNull();
    expect(announced("Link copied")).toBe(false);
  });
});

describe("InviteButton: pressing it", () => {
  it("writes window.location.origin + '/' to the clipboard, once", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard("writes");
    render(<InviteButton />);

    await user.click(invite());
    await settle();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(guestFeed());
    expect(guestFeed()).toMatch(/^https?:\/\/[^/?#]+\/$/);
  });

  it("writes the root, not the page it is on nor that page's query", async () => {
    const previous = window.location.href;
    window.history.replaceState(null, "", "/search?q=raptors#top");
    try {
      const user = userEvent.setup();
      const writeText = stubClipboard("writes");
      render(<InviteButton />);

      await user.click(invite());
      await settle();

      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/`);
      const written = writeText.mock.calls[0]?.[0] ?? "";
      expect(written).not.toMatch(/[?#]/);
      expect(written).not.toContain("search");
    } finally {
      window.history.replaceState(null, "", previous);
    }
  });

  it("makes no network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const beacon =
      typeof navigator.sendBeacon === "function"
        ? vi.spyOn(navigator, "sendBeacon")
        : null;
    try {
      const user = userEvent.setup();
      stubClipboard("writes");
      render(<InviteButton />);

      await user.click(invite());
      await settle();

      expect(fetchSpy).not.toHaveBeenCalled();
      if (beacon !== null) expect(beacon).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      beacon?.mockRestore();
    }
  });
});

describe("InviteButton: a successful copy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("reads Copied for 2 seconds: still at 1999 ms, Invite again at 2000 ms", async () => {
    stubClipboard("writes");
    render(<InviteButton />);
    const button = invite();

    fireEvent.click(button);
    await settle();
    expect(textOf(button)).toBe("Copied");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(textOf(button)).toBe("Copied");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(textOf(button)).toBe("Invite");
  });

  it("keeps the link icon while it reads Copied", async () => {
    stubClipboard("writes");
    render(<InviteButton />);
    const button = invite();

    fireEvent.click(button);
    await settle();

    expect(textOf(button)).toBe("Copied");
    expect(drawsIcon(button, LinkIcon)).toBe(true);
  });

  it("announces Link copied in a polite live region", async () => {
    stubClipboard("writes");
    render(<InviteButton />);

    fireEvent.click(invite());
    await settle();

    expect(announced("Link copied")).toBe(true);
    // Not role="alert": the copy is news, not an error.
    expect(
      [...document.querySelectorAll('[role="alert"], [aria-live="assertive"]')]
        .map(textOf)
        .filter((text) => text.includes("Link copied")),
    ).toEqual([]);
    // It was copied, so the address is not offered for copying by hand.
    expect(shownAddress()).toBeNull();
  });

  it("a second press restarts the 2 seconds", async () => {
    const writeText = stubClipboard("writes");
    render(<InviteButton />);
    const button = invite();

    fireEvent.click(button);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(textOf(button)).toBe("Copied");

    fireEvent.click(button);
    await settle();
    expect(writeText).toHaveBeenCalledTimes(2);

    // 3499 ms after the first press, 1999 after the second: still Copied.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(textOf(button)).toBe("Copied");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(textOf(button)).toBe("Invite");
  });

  it("clears its 2 second timer when unmounted, and warns of nothing", async () => {
    stubClipboard("writes");
    const set = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    try {
      const { unmount } = render(<InviteButton />);

      fireEvent.click(invite());
      await settle();
      expect(textOf(invite())).toBe("Copied");

      const twoSeconds = set.mock.calls
        .map((call, index) => ({
          delay: call[1],
          result: set.mock.results[index],
        }))
        .filter(({ delay }) => delay === 2000)
        .map(({ result }) => result.value as unknown);
      expect(twoSeconds, "a 2000 ms setTimeout for Copied").toHaveLength(1);
      clear.mockClear();

      unmount();

      expect(clear).toHaveBeenCalledWith(twoSeconds[0]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      set.mockRestore();
      clear.mockRestore();
    }
  });
});

describe("InviteButton: no clipboard, or one that refuses", () => {
  it.each(["missing", "refuses"] as const)(
    "a clipboard that is %s: the whole address is shown as selectable text, and nothing throws",
    async (mode) => {
      const user = userEvent.setup();
      stubClipboard(mode);
      render(<InviteButton />);

      await user.click(invite());
      await settle();

      const address = shownAddress();
      expect(address, `the address ${guestFeed()} on the page`).not.toBeNull();
      if (address instanceof HTMLInputElement) {
        expect(address.readOnly).toBe(true);
        expect(address.disabled).toBe(false);
        expect(address).toHaveAccessibleName();
      }
      // Inline, beside the button: not in a dialog or a toast elsewhere.
      expect(address?.closest("dialog, [role='dialog']") ?? null).toBeNull();

      expect(textOf(invite())).toBe("Invite");
      expect(announced("Link copied"), "nothing was copied").toBe(false);
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it("does not throw from the press itself when navigator.clipboard is undefined", () => {
    stubClipboard("missing");
    render(<InviteButton />);

    expect(() => fireEvent.click(invite())).not.toThrow();
  });
});

// ------------------------------------------------------------------ styles

/** Top-level rules of `MODULES` whose last compound is a class `element` carries. */
function carriedRules(element: Element, modules: CssModules): CssBlock[] {
  const found: CssBlock[] = [];
  for (const [path, classes] of Object.entries(modules)) {
    for (const block of parseCss(readSrcFile(path))) {
      if (isAtRule(block)) continue;
      const carried = selectors(block).some((selector) =>
        lastCompoundClasses(selector).some((name) => {
          const mapped = classes[name];
          return (
            typeof mapped === "string" &&
            mapped
              .split(/\s+/)
              .some((cls) => cls !== "" && element.classList.contains(cls))
          );
        }),
      );
      if (carried) found.push(block);
    }
  }
  return found;
}

function values(rules: CssBlock[], property: string): string[] {
  return rules.flatMap((rule) =>
    rule.declarations
      .filter((declaration) => declaration.property === property)
      .map((declaration) => normaliseValue(declaration.value)),
  );
}

/** Rules for the plain state: no :hover, :active, :focus or :disabled. */
function restingRules(rules: CssBlock[]): CssBlock[] {
  return rules.filter((rule) =>
    selectors(rule).every(
      (selector) =>
        !/:(hover|active|focus|disabled|focus-visible)/.test(selector),
    ),
  );
}

describe("InviteButton: its styles", () => {
  it("has its own module, scanned like every components/ui module: tokens only, no px font size, focus kept", () => {
    const css = readFileSync(CSS_FILE, "utf8");

    expect(css.trim().length).toBeGreaterThan(0);
    expect(moduleCssViolations(css)).toEqual([]);
  });

  it("loads nothing: no url(), @import or image in its module", () => {
    const css = readFileSync(CSS_FILE, "utf8");

    expect(css).not.toMatch(/url\(|@import|image-set\(/i);
  });

  it("is at least --target-min (44 px) tall", () => {
    render(<InviteButton />);

    expect(minimumBoxInRem(invite(), MODULES).height).toBeGreaterThanOrEqual(
      TARGET_REM,
    );
  });

  it("keeps a visible focus ring: nothing it carries removes the outline, and any ring it sets is --focus-ring", () => {
    render(<InviteButton />);
    const rules = carriedRules(invite(), MODULES);
    expect(
      rules.length,
      "the button carries some module's rules",
    ).toBeGreaterThan(0);

    for (const outline of [
      ...values(rules, "outline"),
      ...values(rules, "outline-style"),
    ]) {
      expect(outline).not.toMatch(/^(none|0(px)?)(\s|$)/);
    }
    const focusRings = rules
      .filter((rule) =>
        selectors(rule).some((selector) =>
          /:focus(-visible)?\b/.test(selector),
        ),
      )
      .flatMap((rule) => values([rule], "outline"));
    for (const ring of focusRings) {
      expect(ring).toBe("var(--focus-ring)");
    }
  });

  it("has Button secondary's colours: --color-surface fill, --color-text, a solid --color-border-strong edge", () => {
    render(<InviteButton />);
    const button = invite();

    if (button.classList.contains(buttonStyles.secondary)) {
      // Button secondary itself: its colours are pinned with Button.
      expect(button).toHaveClass(buttonStyles.button);
      return;
    }

    const resting = restingRules(carriedRules(button, MODULES));
    const background = [
      ...values(resting, "background-color"),
      ...values(resting, "background"),
    ];
    expect(background.at(-1), "the fill").toBe("var(--color-surface)");
    expect(values(resting, "color").at(-1), "the text").toBe(
      "var(--color-text)",
    );

    const borders = values(resting, "border");
    const borderColours = [
      ...values(resting, "border-color"),
      ...borders.flatMap(
        (border) => border.match(/var\(--color-[\w-]+\)/g) ?? [],
      ),
    ];
    expect(borderColours, "the edge's colour").toContain(
      "var(--color-border-strong)",
    );
    expect(
      [...borders, ...values(resting, "border-style")].some((value) =>
        /\bsolid\b/.test(value),
      ),
      "a solid border, which forced colors keeps (A20)",
    ).toBe(true);
  });

  it("does not opt out of forced colors", () => {
    const css = readFileSync(CSS_FILE, "utf8");

    expect(css).not.toMatch(/forced-color-adjust\s*:\s*none/i);
  });
});
