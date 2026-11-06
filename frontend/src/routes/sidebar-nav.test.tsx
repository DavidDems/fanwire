/**
 * FRONTEND-035 — the icon bar, the left sidebar and the header
 * (`wiki/CodeContext/FrontendUI/decisions.md`, 2026-11-05), through the real
 * route table.
 *
 * **The DOM** (what jsdom can show, `verification.md` §2b): one
 * `<nav aria-label="Primary">` after the header and before `main`, in
 * neither; its items in order, Home, Stats, Search, Notifications, then Sign
 * out as a `<button>` in the list's last item; each with an `aria-hidden` icon
 * and its label in the shared `.visually-hidden` class; the header with the
 * brand first and, at its end, a Search icon link (phones) immediately before
 * the Account menu or Sign in; and the tab order through all of it.
 *
 * **Two Search links, one visible** (the deliberate exception to
 * `layout.md` §1): jsdom applies no media queries, so it sees both. Every
 * Search query here is scoped with `within()` to the header or the nav.
 *
 * **The CSS at each width.** jsdom computes no styles, so this file resolves
 * them itself, as `AppLayout.test.tsx` resolves `main`'s width: every rule of
 * `styles/base.css` (for `.visually-hidden` and the element defaults) and of
 * `AppLayout.module.css` (its class names mapped to the generated ones) whose
 * selector matches the rendered element, under the media queries that hold at
 * a given viewport width, most specific and then last winning, with `color`,
 * `font-size` and `font-weight` inherited. A pseudo-element's rules are read
 * for it alone, so the current item's bar may be drawn on the link or on its
 * `::before` / `::after`. Hover and focus rules never match (nothing is
 * hovered or focused when the styles are read). This pins what each element
 * gets at each width without fixing the implementation's selector names: the
 * only structure assumed is the one the spec implies, that the sidebar and
 * `main` share a parent that the shell's module lays out as one centred group.
 *
 * What it cannot pin, and the browser rows report: overflow at each width, the
 * real heights of the bar and the header, how the icons look, 200% text, and
 * forced colors.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import {
  BellIcon,
  ChartColumnIcon,
  HouseIcon,
  LogOutIcon,
  SearchIcon,
  type IconProps,
} from "../components/ui/icons";
import { deactivatedShown } from "../test/account";
import { OWN_USER_ID, renderAppAt, type Visitor } from "../test/app-route";
import { FakeAuthService } from "../test/auth";
import {
  drawsIcon,
  lengthInRem,
  shorthandParts,
  textOf,
} from "../test/compose-modal";
import {
  isAtRule,
  parseCss,
  readSrcFile,
  selectors,
  type CssBlock,
  type Declaration,
} from "../test/css";
import { testPlayerDetail } from "../test/stats";
import styles from "./AppLayout.module.css";

const PLAYER_PATH = `/players/${testPlayerDetail().id}`;
const OWN_PROFILE_PATH = `/profile/${OWN_USER_ID}`;

/* ------------------------------------------------------------------ render */

const HEADINGS: Record<string, RegExp> = {
  "/": /^feed$/i,
  "/search": /^search$/i,
  "/stats/seasons": /^stats$/i,
  "/stats/players": /^stats$/i,
  "/stats/records": /^stats$/i,
  "/notifications": /^notifications$/i,
  "/sign-in": /^sign\s*-?\s*in$/i,
  "/create-profile": /^create your profile$/i,
  [PLAYER_PATH]: new RegExp(
    `^${testPlayerDetail().first_name} ${testPlayerDetail().last_name}$`,
    "i",
  ),
};

/** Render the app and wait for the view's heading and, for a member, the menu. */
async function show(path: string, as: Visitor) {
  const app = renderAppAt(path, as);
  const heading = HEADINGS[path];
  if (heading === undefined) throw new Error(`no heading known for ${path}`);
  await screen.findByRole("heading", { name: heading });
  if (as === "member") {
    await within(header()).findByRole("button", { name: "Account menu" });
  }
  return app;
}

/** The shell's header: the one banner not inside main or sectioning content. */
function header(): HTMLElement {
  const banners = screen
    .getAllByRole("banner")
    .filter(
      (element) =>
        element.parentElement?.closest("main, article, aside, nav, section") ==
        null,
    );
  if (banners.length !== 1)
    throw new Error(`expected one page banner, found ${banners.length}`);
  return banners[0];
}

function nav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

function main(): HTMLElement {
  return screen.getByRole("main");
}

/** The header's own Search link: never the nav's, wherever the nav is. */
function headerSearch(): HTMLElement {
  const links = within(header())
    .getAllByRole("link", { name: "Search" })
    .filter((link) => link.closest("nav") === null);
  if (links.length !== 1)
    throw new Error(
      `expected one Search link in the header, found ${links.length}`,
    );
  return links[0];
}

const NAV_LINKS: [string, string, ComponentType<IconProps>][] = [
  ["Home", "/", HouseIcon],
  ["Stats", "/stats", ChartColumnIcon],
  ["Search", "/search", SearchIcon],
  ["Notifications", "/notifications", BellIcon],
];

function navLink(name: string): HTMLElement {
  return within(nav()).getByRole("link", { name });
}

function signOut(): HTMLElement {
  return within(nav()).getByRole("button", { name: "Sign out" });
}

/** Each nav item's control in order: the four links, then Sign out if shown. */
function navControls(): HTMLElement[] {
  const links = NAV_LINKS.map(([name]) => navLink(name));
  const out = within(nav()).queryByRole("button", { name: "Sign out" });
  return out === null ? links : [...links, out];
}

const FOCUSABLE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[tabindex]",
].join(", ");

/** Focusable elements in document order, minus the disabled and `tabindex="-1"`. */
function tabbables(): Element[] {
  return [...document.body.querySelectorAll(FOCUSABLE)].filter(
    (element) =>
      element.getAttribute("tabindex") !== "-1" &&
      !element.hasAttribute("disabled"),
  );
}

function follows(earlier: Element, later: Element): boolean {
  return Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

/* ------------------------------------------------------------- the nav DOM */

describe("the Primary nav: one, after the header and before main", () => {
  it.each<[string, Visitor]>([
    ["/", "anonymous"],
    ["/", "member"],
    ["/search", "member"],
    ["/create-profile", "newcomer"],
  ])("at %s for a %s visitor", async (path, as) => {
    await show(path, as);
    const navs = screen.getAllByRole("navigation", { name: "Primary" });

    expect(navs).toHaveLength(1);
    expect(navs[0].tagName).toBe("NAV");
    expect(header()).not.toContainElement(navs[0]);
    expect(main()).not.toContainElement(navs[0]);
    expect(follows(header(), navs[0]), "the nav follows the header").toBe(true);
    expect(follows(navs[0], main()), "main follows the nav").toBe(true);
    // The sidebar and main are one group: siblings, side by side from 40em.
    expect(navs[0].parentElement).toBe(main().parentElement);
  });
});

describe("the nav's items", () => {
  it.each<Visitor>(["anonymous", "member"])(
    "are Home, Stats, Search, Notifications in that order for a %s visitor, with their hrefs",
    async (as) => {
      await show("/", as);

      const links = within(nav()).getAllByRole("link");
      expect(links.map(textOf)).toEqual(NAV_LINKS.map(([name]) => name));
      expect(links.map((link) => link.getAttribute("href"))).toEqual(
        NAV_LINKS.map(([, href]) => href),
      );
      // "Feed" is renamed "Home".
      expect(within(nav()).queryByRole("link", { name: /^feed$/i })).toBeNull();
    },
  );

  it("ends with Sign out for a signed-in visitor: five list items, the last a button", async () => {
    await show("/", "member");

    const items = within(nav()).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items.map(textOf)).toEqual([
      "Home",
      "Stats",
      "Search",
      "Notifications",
      "Sign out",
    ]);
    const button = signOut();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(items[4]).toContainElement(button);
  });

  it("has four list items and no Sign out for an anonymous visitor", async () => {
    await show("/", "anonymous");

    expect(within(nav()).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it.each(NAV_LINKS)(
    "%s carries its aria-hidden icon and its label in the shared visually-hidden class",
    async (name, _href, Icon) => {
      await show("/", "member");
      const link = navLink(name);

      expect(drawsIcon(link, Icon), `${name} draws its icon`).toBe(true);
      const labels = [...link.querySelectorAll(".visually-hidden")];
      expect(labels.map(textOf)).toEqual([name]);
      // The accessible name is the label, and nothing else is read.
      expect(textOf(link)).toBe(name);
    },
  );

  it("Sign out carries the log-out icon, aria-hidden, and its label in the visually-hidden class", async () => {
    await show("/", "member");
    const button = signOut();

    expect(drawsIcon(button, LogOutIcon)).toBe(true);
    expect(
      [...button.querySelectorAll(".visually-hidden")].map(textOf),
    ).toEqual(["Sign out"]);
    expect(textOf(button)).toBe("Sign out");
  });
});

describe("aria-current in the nav", () => {
  const CASES: [string, Visitor, string | null][] = [
    ["/", "member", "Home"],
    ["/stats/seasons", "member", "Stats"],
    ["/stats/players", "anonymous", "Stats"],
    [PLAYER_PATH, "member", "Stats"],
    ["/search", "member", "Search"],
    ["/notifications", "member", "Notifications"],
    ["/create-profile", "newcomer", null],
  ];

  it.each(CASES)(
    "%s (%s): marks %s, and never Sign out",
    async (path, as, current) => {
      await show(path, as);

      const marked = NAV_LINKS.map(([name]) => name).filter(
        (name) => navLink(name).getAttribute("aria-current") === "page",
      );
      expect(marked).toEqual(current === null ? [] : [current]);
      if (as !== "anonymous") {
        expect(signOut()).not.toHaveAttribute("aria-current");
      }
      expect(nav().querySelectorAll("button[aria-current]")).toHaveLength(0);
    },
  );
});

describe("Sign out in the nav", () => {
  it("is shown for a restored session whose account is not deactivated", async () => {
    await show("/create-profile", "newcomer");
    expect(signOut()).toBeInTheDocument();
  });

  it("is not shown for a deactivated account: its banner has the one Sign out", async () => {
    renderAppAt("/", "deactivated");
    await deactivatedShown();

    expect(
      within(nav()).queryByRole("button", { name: "Sign out" }),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: "Sign out" })).toHaveLength(1);
  });

  it("signs out when pressed and moves focus to main", async () => {
    const user = userEvent.setup();
    const app = await show("/search", "member");

    await user.click(signOut());

    expect(
      (app.authService as FakeAuthService).callsTo("signOut"),
    ).toHaveLength(1);
    expect(document.activeElement).toBe(main());
    expect(
      await within(header()).findByRole("link", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});

/* ---------------------------------------------------------- the header DOM */

describe("the header", () => {
  it.each<[string, Visitor, string]>([
    ["/", "member", "Account menu"],
    ["/", "anonymous", "Sign in"],
    [OWN_PROFILE_PATH, "member", "Account menu"],
  ])(
    "at %s for a %s visitor: the brand first, then Search, then %s, and no Sign out",
    async (path, as, end) => {
      if (path === OWN_PROFILE_PATH) {
        renderAppAt(path, as);
        await within(header()).findByRole("button", { name: "Account menu" });
      } else {
        await show(path, as);
      }
      const banner = header();
      const brand = within(banner).getByRole("link", { name: "fanwire" });
      const search = headerSearch();
      const last =
        end === "Sign in"
          ? within(banner).getByRole("link", { name: "Sign in" })
          : within(banner).getByRole("button", { name: "Account menu" });

      const inHeader = tabbables().filter((element) =>
        banner.contains(element),
      );
      expect(inHeader).toEqual([brand, search, last]);
      expect(
        within(banner).queryByRole("button", { name: "Sign out" }),
      ).toBeNull();
    },
  );

  it("on /sign-in, an anonymous visitor's header holds the brand and Search only", async () => {
    await show("/sign-in", "anonymous");
    const banner = header();

    expect(tabbables().filter((element) => banner.contains(element))).toEqual([
      within(banner).getByRole("link", { name: "fanwire" }),
      headerSearch(),
    ]);
  });

  it("holds a Search icon link to /search, named Search, its icon aria-hidden", async () => {
    await show("/", "member");
    const search = headerSearch();

    expect(search).toHaveAttribute("href", "/search");
    expect(drawsIcon(search, SearchIcon)).toBe(true);
    expect(
      within(header()).getAllByRole("link", { name: "Search" }),
    ).toHaveLength(1);
    // The nav keeps its own: the one exception to layout.md §1.
    expect(nav()).not.toContainElement(search);
  });

  it.each<[string, Visitor, boolean]>([
    ["/search", "member", true],
    ["/search", "anonymous", true],
    ["/", "member", false],
    ["/stats/seasons", "anonymous", false],
  ])(
    "at %s (%s) the header's Search is current: %s",
    async (path, as, current) => {
      await show(path, as);

      if (current) {
        expect(headerSearch()).toHaveAttribute("aria-current", "page");
      } else {
        expect(headerSearch()).not.toHaveAttribute("aria-current");
      }
    },
  );

  it("keeps the Account menu's name and items", async () => {
    const user = userEvent.setup();
    await show("/", "member");

    await user.click(
      within(header()).getByRole("button", { name: "Account menu" }),
    );
    const menu = screen.getByRole("menu", { name: "Account menu" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => textOf(item)),
    ).toEqual(["Profile", "History", "Account settings"]);
  });
});

/* -------------------------------------------------------------- tab order */

describe("the tab order", () => {
  it.each<[string, Visitor]>([
    ["/", "member"],
    ["/", "anonymous"],
    ["/create-profile", "newcomer"],
  ])(
    "at %s for a %s visitor: skip link, brand, header Search, Account menu or Sign in, the nav in order, then main",
    async (path, as) => {
      await show(path, as);
      const banner = header();
      const expected: Element[] = [
        screen.getByRole("link", { name: "Skip to content" }),
        within(banner).getByRole("link", { name: "fanwire" }),
        headerSearch(),
        ...(as === "member"
          ? [within(banner).getByRole("button", { name: "Account menu" })]
          : as === "anonymous"
            ? [within(banner).getByRole("link", { name: "Sign in" })]
            : []),
        ...navControls(),
      ];

      const order = tabbables();
      expect(order.slice(0, expected.length)).toEqual(expected);
      // Then main: whatever comes next is main's, if main has anything.
      const rest = order.slice(expected.length);
      const firstInMain = rest.findIndex((element) => main().contains(element));
      if (firstInMain !== -1) expect(firstInMain).toBe(0);
      // No positive tabindex reorders it.
      expect(
        [...document.querySelectorAll("[tabindex]")].filter(
          (element) => Number(element.getAttribute("tabindex")) > 0,
        ),
      ).toEqual([]);
    },
  );

  it("is walked by Tab from the skip link, which moves focus to main", async () => {
    const user = userEvent.setup();
    await show("/", "member");
    const banner = header();

    const walked: Element[] = [];
    for (let step = 0; step < 9; step += 1) {
      await user.tab();
      walked.push(document.activeElement as Element);
    }
    expect(walked).toEqual([
      screen.getByRole("link", { name: "Skip to content" }),
      within(banner).getByRole("link", { name: "fanwire" }),
      headerSearch(),
      within(banner).getByRole("button", { name: "Account menu" }),
      ...navControls(),
    ]);

    (walked[0] as HTMLElement).focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(main());
  });
});

/* ------------------------------------------------- the CSS, width by width */

/** Viewport widths in em (16 px), one inside each band the spec names. */
const PHONE = 22.5; // 360 px
const FROM_40 = 40; // 640 px
const TABLET = 48; // 768 px: unchanged icon-only layout
const BELOW_LABEL = 53.6875; // 859 px
const FROM_LABEL = 53.75; // 860 px
const RAIL = 76; // 1216 px: labelled sidebar, feed and rail fit
const FROM_78 = 78; // 1248 px: desktop look
const WIDE = 120; // 1920 px

const SIDEBAR_COMPACT = [FROM_40, TABLET, BELOW_LABEL];
const SIDEBAR_LABELLED = [FROM_LABEL, RAIL, FROM_78, WIDE];
const SIDEBAR = [...SIDEBAR_COMPACT, ...SIDEBAR_LABELLED];

interface Rule {
  /** The selector as written, `:global()` unwrapped: for specificity. */
  source: string;
  /** The selector to match against the rendered DOM. */
  dom: string;
  pseudo: string | null;
  media: string[];
  declarations: Declaration[];
}

interface Applied {
  property: string;
  value: string;
  important: boolean;
  specificity: number;
  order: number;
}

const classMap = styles as unknown as Record<string, string>;

/** `selector` with the module's class names mapped to the generated ones. */
function mapModuleClasses(selector: string): string {
  const globals: string[] = [];
  const held = selector.replace(
    /:global\(((?:[^()]|\([^()]*\))*)\)/g,
    (_all, inner: string) => {
      globals.push(inner);
      return `\u0000${globals.length - 1}\u0000`;
    },
  );
  const mapped = held.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (all, name: string) => {
    const generated = classMap[name];
    return typeof generated === "string"
      ? generated
          .split(/\s+/)
          .filter((c) => c !== "")
          .map((c) => `.${c}`)
          .join("")
      : all;
  });
  return mapped.replace(
    /\u0000(\d+)\u0000/g,
    (_all, i: string) => globals[Number(i)],
  );
}

function unwrapGlobal(selector: string): string {
  return selector.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, "$1");
}

const PSEUDO_ELEMENT = /::?(before|after)$/i;

function specificity(selector: string, pseudo: boolean): number {
  let text = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
  text = text.replace(/:(is|not|has)\(/g, " (");
  const ids = (text.match(/#[\w-]+/g) ?? []).length;
  const classes = (text.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) ?? [])
    .length;
  const elements = (
    text
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[.#:]+[\w-]+/g, " ")
      .match(/(?:^|[\s>+~(])[a-z][\w-]*/gi) ?? []
  ).length;
  return ids * 10_000 + classes * 100 + elements + (pseudo ? 1 : 0);
}

function flatten(
  blocks: CssBlock[],
  module: boolean,
  media: string[],
  parents: string[] | null,
  out: Rule[],
): void {
  const push = (
    selector: string,
    declarations: Declaration[],
    within: string[] = media,
  ) => {
    if (declarations.length === 0) return;
    const source = unwrapGlobal(selector);
    const pseudoMatch = PSEUDO_ELEMENT.exec(source);
    const pseudo = pseudoMatch ? `::${pseudoMatch[1].toLowerCase()}` : null;
    let dom = module ? mapModuleClasses(selector) : selector;
    dom = unwrapGlobal(dom);
    if (pseudo !== null) {
      dom = dom.replace(PSEUDO_ELEMENT, "");
      if (dom === "" || /[\s>+~]$/.test(dom)) dom += "*";
    }
    if (dom.includes("::")) return;
    out.push({ source, dom, pseudo, media: within, declarations });
  };

  for (const block of blocks) {
    if (isAtRule(block)) {
      const at = block.prelude;
      let inner = media;
      if (/^@media\b/i.test(at)) inner = [...media, at];
      else if (!/^@(supports|layer)\b/i.test(at)) continue;
      if (parents !== null) {
        for (const parent of parents) push(parent, block.declarations, inner);
      }
      flatten(block.children, module, inner, parents, out);
      continue;
    }
    const own = selectors(block);
    const full =
      parents === null
        ? own
        : parents.flatMap((parent) =>
            own.map((selector) =>
              selector.includes("&")
                ? selector.replace(/&/g, parent)
                : `${parent} ${selector}`,
            ),
          );
    for (const selector of full) push(selector, block.declarations);
    flatten(block.children, module, media, full, out);
  }
}

const RULES: Rule[] = (() => {
  const out: Rule[] = [];
  flatten(parseCss(readSrcFile("styles/base.css")), false, [], null, out);
  flatten(
    parseCss(readSrcFile("routes/AppLayout.module.css")),
    true,
    [],
    null,
    out,
  );
  return out;
})();

function toEm(value: string, unit: string): number {
  return unit === "px" ? Number(value) / 16 : Number(value);
}

/** Does one media feature hold at `width` em, in a light, unforced screen? */
function featureHolds(feature: string, width: number): boolean {
  const f = feature.trim().toLowerCase();
  let m = /^min-width\s*:\s*([\d.]+)(em|rem|px)$/.exec(f);
  if (m) return width >= toEm(m[1], m[2]);
  m = /^max-width\s*:\s*([\d.]+)(em|rem|px)$/.exec(f);
  if (m) return width <= toEm(m[1], m[2]);
  m =
    /^(?:([\d.]+)(em|rem|px)\s*(<=|<)\s*)?width\s*(?:(<=|<|>=|>)\s*([\d.]+)(em|rem|px))?$/.exec(
      f,
    );
  if (m && (m[1] !== undefined || m[4] !== undefined)) {
    if (m[1] !== undefined) {
      const low = toEm(m[1], m[2]);
      if (m[3] === "<=" ? width < low : width <= low) return false;
    }
    if (m[4] !== undefined) {
      const bound = toEm(m[5], m[6]);
      if (m[4] === "<=" && !(width <= bound)) return false;
      if (m[4] === "<" && !(width < bound)) return false;
      if (m[4] === ">=" && !(width >= bound)) return false;
      if (m[4] === ">" && !(width > bound)) return false;
    }
    return true;
  }
  // prefers-color-scheme: dark, forced-colors, reduced motion, hover…: no.
  return false;
}

function mediaHolds(prelude: string, width: number): boolean {
  const query = prelude.replace(/^@media\s*/i, "");
  return query.split(",").some((part) => {
    const text = part.trim().toLowerCase();
    if (/^not\b/.test(text) || /\bprint\b/.test(text)) return false;
    const features = [...text.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
    return features.every((feature) => featureHolds(feature, width));
  });
}

/** Every declaration that applies to `element` (or its pseudo) at `width`, in cascade order. */
function applied(
  element: Element,
  width: number,
  pseudo: string | null = null,
): Applied[] {
  const found: Applied[] = [];
  RULES.forEach((rule, order) => {
    if (rule.pseudo !== pseudo) return;
    if (!rule.media.every((m) => mediaHolds(m, width))) return;
    let matches = false;
    try {
      matches = element.matches(rule.dom);
    } catch {
      matches = false;
    }
    if (!matches) return;
    const weight = specificity(rule.source, pseudo !== null);
    for (const { property, value } of rule.declarations) {
      const important = /!\s*important\s*$/i.test(value);
      found.push({
        property,
        value: value
          .replace(/!\s*important\s*$/i, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase(),
        important,
        specificity: weight,
        order,
      });
    }
  });
  return found.sort(
    (a, b) =>
      Number(a.important) - Number(b.important) ||
      a.specificity - b.specificity ||
      a.order - b.order,
  );
}

const INHERITED = new Set(["color", "font-size", "font-weight", "visibility"]);

/** The value `element` gets for `property` at `width`, or `undefined`. */
function styleOf(
  element: Element,
  property: string,
  width: number,
  pseudo: string | null = null,
): string | undefined {
  const value = applied(element, width, pseudo)
    .filter((d) => d.property === property)
    .pop()?.value;
  if ((value === undefined && INHERITED.has(property)) || value === "inherit") {
    const parent = pseudo !== null ? element : element.parentElement;
    return parent === null ? undefined : styleOf(parent, property, width);
  }
  return value;
}

/** `element` and its ancestors all have a display other than none at `width`. */
function displayed(element: Element, width: number): boolean {
  for (
    let node: Element | null = element;
    node !== null && node !== document.body;
    node = node.parentElement
  ) {
    if (styleOf(node, "display", width) === "none") return false;
  }
  return true;
}

/** Hidden the `.visually-hidden` way: taken out of flow and clipped to nothing. */
function visuallyHidden(element: Element, width: number): boolean {
  const position = styleOf(element, "position", width);
  const clip = styleOf(element, "clip", width);
  const clipPath = styleOf(element, "clip-path", width);
  const w = styleOf(element, "width", width);
  const h = styleOf(element, "height", width);
  return (
    (position === "absolute" || position === "fixed") &&
    ((clip !== undefined && clip.startsWith("rect")) ||
      (clipPath !== undefined && clipPath !== "none") ||
      (w === "1px" && h === "1px"))
  );
}

/** The largest length in rem `element` declares for any of `properties` at `width`. */
function largestLength(
  element: Element,
  properties: string[],
  width: number,
): number {
  let largest = 0;
  for (const property of properties) {
    const value = styleOf(element, property, width);
    const rem = value === undefined ? null : lengthInRem(value);
    if (rem !== null) largest = Math.max(largest, rem);
  }
  return largest;
}

const TARGET_MIN = lengthInRem("var(--target-min)") ?? NaN;

function minHeight(element: Element, width: number): number {
  return largestLength(
    element,
    ["min-height", "height", "block-size", "min-block-size"],
    width,
  );
}

function minWidth(element: Element, width: number): number {
  return largestLength(
    element,
    ["min-width", "width", "inline-size", "min-inline-size"],
    width,
  );
}

const BORDER_STYLES =
  /^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/;

const BORDER_WIDTH = /^(\d|\.|thin$|medium$|thick$|calc\(|var\()/;

interface Edge {
  width: string;
  style: string;
  color: string;
}

/** The border on one edge of `element` (or its pseudo) at `width`. */
function edgeOf(
  element: Element,
  width: number,
  side: "top" | "inline-start",
  pseudo: string | null,
): Edge {
  const physical = side === "top" ? "top" : "left";
  const logical = side === "top" ? "block-start" : "inline-start";
  const axis = side === "top" ? "block" : "inline";
  const fourIndex = side === "top" ? 0 : 3;
  const edge: Edge = { width: "medium", style: "none", color: "currentcolor" };

  const pick = (value: string, index: number) => {
    const parts = shorthandParts(value);
    if (index === 0) return parts[0];
    return parts[3] ?? parts[1] ?? parts[0];
  };

  for (const { property, value } of applied(element, width, pseudo)) {
    if (
      property === "border" ||
      property === `border-${physical}` ||
      property === `border-${logical}` ||
      property === `border-${axis}`
    ) {
      edge.width = "medium";
      edge.style = "none";
      edge.color = "currentcolor";
      for (const part of shorthandParts(value)) {
        if (BORDER_STYLES.test(part)) edge.style = part;
        else if (BORDER_WIDTH.test(part) && !/^var\(--color-/.test(part))
          edge.width = part;
        else edge.color = part;
      }
    } else if (
      property === `border-${physical}-width` ||
      property === `border-${logical}-width`
    ) {
      edge.width = value;
    } else if (
      property === `border-${physical}-style` ||
      property === `border-${logical}-style`
    ) {
      edge.style = value;
    } else if (
      property === `border-${physical}-color` ||
      property === `border-${logical}-color`
    ) {
      edge.color = value;
    } else if (property === "border-width") {
      edge.width = pick(value, fourIndex);
    } else if (property === "border-style") {
      edge.style = pick(value, fourIndex);
    } else if (property === "border-color") {
      edge.color = pick(value, fourIndex);
    } else if (property === `border-${axis}-width`) {
      edge.width = shorthandParts(value)[0];
    } else if (property === `border-${axis}-style`) {
      edge.style = shorthandParts(value)[0];
    } else if (property === `border-${axis}-color`) {
      edge.color = shorthandParts(value)[0];
    }
  }
  return edge;
}

/**
 * Is a 3px `--color-action` bar drawn as a border on `side` of `element`, on
 * the element itself or on a rendered `::before` / `::after`?
 */
function hasActionBar(
  element: Element,
  width: number,
  side: "top" | "inline-start",
): boolean {
  return [null, "::before", "::after"].some((pseudo) => {
    if (pseudo !== null) {
      const content = styleOf(element, "content", width, pseudo);
      if (content === undefined || content === "none") return false;
      if (styleOf(element, "display", width, pseudo) === "none") return false;
    }
    const edge = edgeOf(element, width, side, pseudo);
    return (
      edge.width === "3px" &&
      edge.style !== "none" &&
      edge.style !== "hidden" &&
      edge.color === "var(--color-action)"
    );
  });
}

/** The nav's (or its list's) width, or the column its parent's grid gives it. */
function sidebarWidth(element: HTMLElement, width: number): string[] {
  const found: string[] = [];
  for (const node of [element, element.querySelector("ul")]) {
    if (node === null) continue;
    for (const property of ["width", "inline-size", "flex-basis"]) {
      const value = styleOf(node, property, width);
      if (value !== undefined) found.push(value);
    }
    const flex = styleOf(node, "flex", width);
    if (flex !== undefined) found.push(shorthandParts(flex)[2] ?? "");
  }
  const parent = element.parentElement;
  if (parent !== null) {
    const columns = styleOf(parent, "grid-template-columns", width);
    if (columns !== undefined) found.push(columns);
  }
  return found;
}

/** The start (left) margin of `element` at `width`, from longhands or shorthands. */
function marginStart(element: Element, width: number): string | undefined {
  let found: string | undefined;
  for (const { property, value } of applied(element, width)) {
    if (property === "margin-left" || property === "margin-inline-start")
      found = value;
    else if (property === "margin-inline") found = shorthandParts(value)[0];
    else if (property === "margin") {
      const parts = shorthandParts(value);
      found = parts[3] ?? parts[1] ?? parts[0];
    }
  }
  return found;
}

function marginEnd(element: Element, width: number): string | undefined {
  let found: string | undefined;
  for (const { property, value } of applied(element, width)) {
    if (property === "margin-right" || property === "margin-inline-end")
      found = value;
    else if (property === "margin-inline") {
      const parts = shorthandParts(value);
      found = parts[1] ?? parts[0];
    } else if (property === "margin") {
      const parts = shorthandParts(value);
      found = parts[1] ?? parts[0];
    }
  }
  return found;
}

const SEMIBOLD = ["600", "var(--font-weight-semibold)"];

describe("the readers see the real rules (not vacuously green)", () => {
  it("finds the shell's rules and base.css's .visually-hidden", () => {
    expect(RULES.some((rule) => rule.source === ".visually-hidden")).toBe(true);
    expect(RULES.some((rule) => rule.source === ".main")).toBe(true);
    expect(TARGET_MIN).toBe(2.75);
  });

  it("resolves a known rule: main keeps var(--content-max) at every width", async () => {
    await show("/", "anonymous");

    for (const width of [PHONE, FROM_40, FROM_78, WIDE]) {
      expect(styleOf(main(), "max-width", width), `at ${width}em`).toBe(
        "var(--content-max)",
      );
    }
  });
});

describe("below 40em: the bottom bar", () => {
  it("is fixed to the bottom of the viewport", async () => {
    await show("/", "member");

    expect(styleOf(nav(), "position", PHONE)).toBe("fixed");
    expect(lengthInRem(styleOf(nav(), "bottom", PHONE) ?? "")).toBe(0);
  });

  it("shows Home, Stats, Notifications and Sign out, and hides the nav's Search (display: none)", async () => {
    await show("/", "member");

    for (const name of ["Home", "Stats", "Notifications"]) {
      expect(displayed(navLink(name), PHONE), `${name} shown`).toBe(true);
    }
    expect(displayed(signOut(), PHONE), "Sign out shown").toBe(true);
    expect(displayed(navLink("Search"), PHONE), "the nav's Search").toBe(false);
  });

  it("shows icons only: every label is visually hidden", async () => {
    await show("/", "member");

    for (const control of navControls()) {
      const label = control.querySelector(".visually-hidden");
      expect(label, `${textOf(control)} has a label`).not.toBeNull();
      expect(
        visuallyHidden(label as Element, PHONE),
        `${textOf(control)}'s label`,
      ).toBe(true);
    }
  });

  it("makes every cell at least --target-min tall", async () => {
    await show("/", "member");

    for (const control of navControls()) {
      expect(
        minHeight(control, PHONE),
        `${textOf(control)}'s min-height`,
      ).toBeGreaterThanOrEqual(TARGET_MIN);
    }
  });

  it("shows the header's Search, beside the Account menu", async () => {
    await show("/", "member");

    expect(displayed(headerSearch(), PHONE)).toBe(true);
  });
});

describe("from 40em: the left sidebar", () => {
  it("hides the header's Search (display: none) at every sidebar width", async () => {
    await show("/", "member");

    for (const width of SIDEBAR) {
      expect(displayed(headerSearch(), width), `at ${width}em`).toBe(false);
    }
  });

  it("is sticky, not fixed, under the header", async () => {
    await show("/", "member");

    for (const width of SIDEBAR) {
      expect(styleOf(nav(), "position", width), `at ${width}em`).toBe("sticky");
      expect(styleOf(nav(), "top", width), `top at ${width}em`).toBeDefined();
    }
  });

  it("lists all five items, Search included", async () => {
    await show("/", "member");

    for (const width of SIDEBAR) {
      for (const control of navControls()) {
        expect(
          displayed(control, width),
          `${textOf(control)} at ${width}em`,
        ).toBe(true);
      }
    }
  });

  it("is var(--sidebar-width-compact) wide and icon only from 40em to just below 53.75em", async () => {
    await show("/", "member");

    for (const width of SIDEBAR_COMPACT) {
      expect(
        sidebarWidth(nav(), width).some((value) =>
          value.includes("var(--sidebar-width-compact)"),
        ),
        `width at ${width}em: ${sidebarWidth(nav(), width).join(" | ")}`,
      ).toBe(true);
      for (const control of navControls()) {
        const label = control.querySelector(".visually-hidden") as Element;
        expect(
          visuallyHidden(label, width),
          `${textOf(control)}'s label at ${width}em`,
        ).toBe(true);
      }
    }
  });

  it("makes each icon-only item at least --target-min square", async () => {
    await show("/", "member");

    for (const width of SIDEBAR_COMPACT) {
      for (const control of navControls()) {
        expect(
          minHeight(control, width),
          `${textOf(control)}'s height at ${width}em`,
        ).toBeGreaterThanOrEqual(TARGET_MIN);
        expect(
          minWidth(control, width),
          `${textOf(control)}'s width at ${width}em`,
        ).toBeGreaterThanOrEqual(TARGET_MIN);
      }
    }
  });

  it("from 53.75em onward is var(--sidebar-width) wide, each item an icon then its visible label at --font-size-md, on one row", async () => {
    await show("/", "member");

    for (const width of SIDEBAR_LABELLED) {
      expect(
        sidebarWidth(nav(), width).some(
          (value) =>
            value.includes("var(--sidebar-width)") &&
            !value.includes("var(--sidebar-width-compact)"),
        ),
        `width at ${width}em: ${sidebarWidth(nav(), width).join(" | ")}`,
      ).toBe(true);
      for (const control of navControls()) {
        const name = textOf(control);
        const label = control.querySelector(".visually-hidden") as Element;
        const icon = control.querySelector("svg") as Element;
        expect(visuallyHidden(label, width), `${name}'s label shown`).toBe(
          false,
        );
        expect(displayed(label, width)).toBe(true);
        expect(styleOf(label, "font-size", width), `${name}'s size`).toBe(
          "var(--font-size-md)",
        );
        expect(follows(icon, label), `${name}: the icon, then the label`).toBe(
          true,
        );
        expect(styleOf(control, "flex-direction", width) ?? "row").not.toMatch(
          /^column/,
        );
        expect(
          minHeight(control, width),
          `${name}'s height`,
        ).toBeGreaterThanOrEqual(TARGET_MIN);
      }
    }
  });

  it("sits with main as one group centred in the viewport, --space-5 between them", async () => {
    await show("/", "member");
    const group = nav().parentElement as HTMLElement;
    expect(group).toBe(main().parentElement);

    for (const width of SIDEBAR) {
      const display = styleOf(group, "display", width) ?? "";
      expect(display, `the group's display at ${width}em`).toMatch(
        /^(inline-)?(flex|grid)$/,
      );
      const gap =
        styleOf(group, "column-gap", width) ??
        shorthandParts(styleOf(group, "gap", width) ?? "").pop();
      expect(
        gap === "var(--space-5)" ||
          marginEnd(nav(), width) === "var(--space-5)",
        `--space-5 between the sidebar and main at ${width}em (gap ${String(gap)})`,
      ).toBe(true);
      const justify =
        styleOf(group, "justify-content", width) ??
        shorthandParts(styleOf(group, "place-content", width) ?? "").pop();
      const centredByMargin =
        marginStart(group, width) === "auto" &&
        marginEnd(group, width) === "auto";
      expect(
        (justify ?? "").replace(/^safe\s+/, "") === "center" || centredByMargin,
        `the group is centred at ${width}em`,
      ).toBe(true);
    }
  });

  it("keeps main at var(--content-max), and the records home at var(--content-max-wide)", async () => {
    await show("/", "member");
    for (const width of SIDEBAR) {
      expect(styleOf(main(), "max-width", width)).toBe("var(--content-max)");
    }
  });
});

describe("the records home's wide column beside the sidebar", () => {
  it("keeps var(--content-max-wide) on /stats/records at every sidebar width", async () => {
    await show("/stats/records", "anonymous");
    for (const width of SIDEBAR) {
      expect(styleOf(main(), "max-width", width), `at ${width}em`).toBe(
        "var(--content-max-wide)",
      );
    }
  });
});

describe("the current item, in the bar and the sidebar", () => {
  it.each([PHONE, ...SIDEBAR])(
    "at %sem on /stats/seasons: Stats is 600 and --color-text; the others and Sign out --color-text-muted",
    async (width) => {
      await show("/stats/seasons", "member");

      const current = navLink("Stats");
      expect(SEMIBOLD).toContain(styleOf(current, "font-weight", width));
      expect(styleOf(current, "color", width)).toBe("var(--color-text)");
      for (const control of [
        navLink("Home"),
        navLink("Search"),
        navLink("Notifications"),
        signOut(),
      ]) {
        expect(
          styleOf(control, "color", width),
          `${textOf(control)}'s colour`,
        ).toBe("var(--color-text-muted)");
      }
    },
  );

  it("draws a 3px --color-action border on the top edge in the phone bar", async () => {
    await show("/stats/seasons", "member");

    expect(hasActionBar(navLink("Stats"), PHONE, "top")).toBe(true);
    for (const name of ["Home", "Notifications"]) {
      expect(hasActionBar(navLink(name), PHONE, "top"), name).toBe(false);
    }
    expect(hasActionBar(signOut(), PHONE, "top"), "Sign out").toBe(false);
  });

  it.each(SIDEBAR)(
    "at %sem draws it on the inline-start edge in the sidebar, and not on the top",
    async (width) => {
      await show("/stats/seasons", "member");

      expect(hasActionBar(navLink("Stats"), width, "inline-start")).toBe(true);
      expect(hasActionBar(navLink("Stats"), width, "top")).toBe(false);
      for (const control of [
        navLink("Home"),
        navLink("Search"),
        navLink("Notifications"),
        signOut(),
      ]) {
        expect(
          hasActionBar(control, width, "inline-start"),
          textOf(control),
        ).toBe(false);
      }
    },
  );

  it("marks Stats on a player page too, in the bar and the sidebar", async () => {
    await show(PLAYER_PATH, "member");

    expect(hasActionBar(navLink("Stats"), PHONE, "top")).toBe(true);
    expect(hasActionBar(navLink("Stats"), FROM_78, "inline-start")).toBe(true);
  });
});

describe("the header's ends", () => {
  /** The header's direct children shown at `width`. */
  function shownChildren(width: number): Element[] {
    return [...header().children].filter((child) => displayed(child, width));
  }

  it.each<[Visitor, number]>([
    ["member", PHONE],
    ["member", FROM_40],
    ["member", WIDE],
    ["anonymous", PHONE],
    ["anonymous", FROM_78],
  ])(
    "for a %s visitor at %sem: the brand at the start, the rest pushed to the end",
    async (as, width) => {
      await show("/", as);
      const brand = within(header()).getByRole("link", { name: "fanwire" });
      const children = shownChildren(width);

      expect(children[0]).toContainElement(brand);
      expect(children.length, "something at the end").toBeGreaterThan(1);
      const justify = styleOf(header(), "justify-content", width);
      expect(
        (justify === "space-between" && children.length === 2) ||
          marginStart(children[1], width) === "auto",
        `the header's second shown child is pushed to the end at ${width}em`,
      ).toBe(true);
      // Nothing after it is pushed again, which would split the end group.
      for (const later of children.slice(2)) {
        expect(marginStart(later, width)).not.toBe("auto");
      }
    },
  );
});
