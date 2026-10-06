/**
 * UI-003 — the app shell and the brand in the header
 * (`wiki/CodeContext/FrontendUI/layout.md` §2, `accessibility.md` A7, A11–A14,
 * A19), through the real route table.
 *
 * What jsdom can honestly show about a shell (`verification.md` §2b): the
 * landmarks, names, `alt` text, `aria-current`, `aria-hidden` and where focus
 * goes. Where things sit on screen is CSS, pinned statically in
 * `shell-css.test.ts`; the one bridge between the two is the last describe
 * here, which checks that the `<nav>` really carries the class the CSS fixes
 * to the bottom.
 *
 * **One nav, never two** (`layout.md` §1): jsdom applies no media queries, so
 * a second nav for desktop would be "visible" to every test. Hence exactly one
 * navigation named Primary on every route, for every visitor.
 *
 * The Sign in link is asserted inside the banner only. `/confirm` and
 * `/forgot-password` carry their own "Back to sign in" link, so a whole-page
 * query for a sign-in link would be ambiguous there; scoping to the banner
 * pins the header's link and nothing else.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BellIcon,
  HouseIcon,
  SearchIcon,
  SquarePenIcon,
  UserIcon,
  type IconProps,
} from "../components/ui/icons";
import { OWN_USER_ID, renderAppAt, type Visitor } from "../test/app-route";
import { testProfile } from "../test/auth";
import { SRC_DIR, parseCss, readSrcFile, selectors } from "../test/css";
import {
  lastCompoundClasses,
  topLevelFixedBottomRules,
} from "../test/module-css";
import { usernameForId } from "../test/users";

interface Visit {
  path: string;
  as: Visitor;
  /** The view's own heading: what says the route has rendered. */
  heading: RegExp;
}

const exactly = (text: string) => new RegExp(`^${text}$`, "i");

const OWN_PROFILE_PATH = `/profile/${OWN_USER_ID}`;
const OTHER_PROFILE_PATH = "/profile/42";

/**
 * Every route in the table, for every visitor its guards let render it, plus
 * the signed-in member on each public route, and on their own profile.
 */
const VISITS: Visit[] = [
  { path: "/", as: "anonymous", heading: /^feed$/i },
  { path: "/search", as: "anonymous", heading: /^search$/i },
  {
    path: OTHER_PROFILE_PATH,
    as: "anonymous",
    heading: exactly(usernameForId(42)),
  },
  { path: "/sign-in", as: "anonymous", heading: /^sign\s*-?\s*in$/i },
  { path: "/sign-up", as: "anonymous", heading: /^sign\s*-?\s*up$/i },
  { path: "/confirm", as: "anonymous", heading: /^confirm/i },
  {
    path: "/forgot-password",
    as: "anonymous",
    heading: /^forgot\s*-?\s*password$/i,
  },
  {
    path: "/no-such-page-exists",
    as: "anonymous",
    heading: /^not\s*-?\s*found$/i,
  },
  { path: "/", as: "member", heading: /^feed$/i },
  { path: "/compose", as: "member", heading: /^compose$/i },
  { path: "/notifications", as: "member", heading: /^notifications$/i },
  { path: "/search", as: "member", heading: /^search$/i },
  {
    path: OTHER_PROFILE_PATH,
    as: "member",
    heading: exactly(usernameForId(42)),
  },
  {
    path: OWN_PROFILE_PATH,
    as: "member",
    heading: exactly(testProfile().username),
  },
  {
    path: "/no-such-page-exists",
    as: "member",
    heading: /^not\s*-?\s*found$/i,
  },
  {
    path: "/create-profile",
    as: "newcomer",
    heading: /^create your profile$/i,
  },
];

function visit(path: string, as: Visitor): Visit {
  const found = VISITS.find((v) => v.path === path && v.as === as);
  if (found === undefined) throw new Error(`no visit ${as} ${path}`);
  return found;
}

/**
 * The page's banners: every `banner` Testing Library finds, minus a `<header>`
 * inside `main` or sectioning content.
 *
 * Testing Library gives every `<header>` the banner role, but HTML-AAM maps a
 * `<header>` scoped to `main`, `article`, `aside`, `nav` or `section` to a
 * plain group, not a landmark — and the profile page's own `<header>`
 * (`ProfileSummary`) and each post's (`PostNode`) are exactly that. Only the
 * shell's header is the page's banner.
 */
function pageBanners(): HTMLElement[] {
  return screen
    .getAllByRole("banner")
    .filter(
      (element) =>
        element.parentElement?.closest("main, article, aside, nav, section") ==
        null,
    );
}

function pageBanner(): HTMLElement {
  const banners = pageBanners();
  if (banners.length !== 1)
    throw new Error(`expected one page banner, found ${banners.length}`);
  return banners[0];
}

function primaryNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

/**
 * Render the app at the visit's path and wait for the view's heading — and,
 * for a member, for "Your profile", the nav link that only appears once
 * `GET /users/me` has answered, so the whole nav is on screen.
 */
async function renderVisit({ path, as, heading }: Visit): Promise<void> {
  renderAppAt(path, as);
  await screen.findByRole("heading", { name: heading });
  if (as === "member") {
    await within(primaryNav()).findByRole("link", { name: "Your profile" });
  }
}

const NAV_ITEMS: [string, ComponentType<IconProps>][] = [
  ["Feed", HouseIcon],
  ["Compose", SquarePenIcon],
  ["Notifications", BellIcon],
  ["Search", SearchIcon],
  ["Your profile", UserIcon],
];

function navNamesFor(as: Visitor): string[] {
  const names = NAV_ITEMS.map(([name]) => name);
  return as === "member" ? names : names.filter((n) => n !== "Your profile");
}

/** An icon's drawing — its shape elements and their attributes — independent of size or class. */
function shapes(svg: Element): string[] {
  return [...svg.children].map((shape) => {
    const attributes = [...shape.attributes]
      .map((attribute) => `${attribute.name}=${attribute.value}`)
      .sort();
    return `${shape.localName}[${attributes.join(" ")}]`;
  });
}

function referenceShapes(Icon: ComponentType<IconProps>): string[] {
  const template = document.createElement("template");
  template.innerHTML = renderToStaticMarkup(<Icon />);
  const svg = template.content.querySelector("svg");
  if (svg === null) throw new Error("the reference icon rendered no <svg>");
  return shapes(svg);
}

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "iframe",
  "[tabindex]",
  "[contenteditable='']",
  "[contenteditable='true']",
].join(", ");

/** Focusable elements in document order, minus the disabled and the `tabindex="-1"`. */
function tabbables(): Element[] {
  return [...document.body.querySelectorAll(FOCUSABLE)].filter(
    (element) =>
      element.getAttribute("tabindex") !== "-1" &&
      !element.hasAttribute("disabled"),
  );
}

/**
 * A dynamic import Vite does not resolve at transform time.
 *
 * A literal `import("../assets/brand/symbol.svg")` is resolved when this file
 * is transformed, so a file the implementation has not added yet would fail
 * the whole file to load and hide every other test's red. A computed
 * specifier is resolved only when the test that needs it runs.
 */
async function importLate<T>(specifier: string): Promise<{ default: T }> {
  return (await import(/* @vite-ignore */ specifier)) as { default: T };
}

describe("landmarks (criterion 2)", () => {
  it.each(VISITS)(
    "$path for a $as visitor has one main#main, one banner and one Primary nav",
    async (v) => {
      await renderVisit(v);

      const mains = screen.getAllByRole("main");
      expect(mains).toHaveLength(1);
      expect(mains[0]).toHaveAttribute("id", "main");
      expect(document.querySelectorAll("#main")).toHaveLength(1);

      expect(pageBanners()).toHaveLength(1);
      const navs = screen.getAllByRole("navigation", { name: "Primary" });
      expect(navs).toHaveLength(1);
      // Inside the header in the DOM: the CSS moves it to the bottom bar on
      // phones, but from 40em it sits in the header, so that is where it lives.
      expect(pageBanner()).toContainElement(navs[0]);
    },
  );
});

describe("the skip link (criterion 3)", () => {
  it.each([
    visit("/", "anonymous"),
    visit("/", "member"),
    visit("/search", "anonymous"),
  ])("is the first focusable element at $path for a $as visitor", async (v) => {
    await renderVisit(v);
    const skip = screen.getByRole("link", { name: "Skip to content" });

    expect(tabbables()[0]).toBe(skip);

    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(skip);
  });

  it("points at main", async () => {
    await renderVisit(visit("/", "anonymous"));

    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#main");
  });

  it("moves focus to main when activated from the keyboard", async () => {
    await renderVisit(visit("/search", "anonymous"));
    const user = userEvent.setup();

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Skip to content" }),
    );
    await user.keyboard("{Enter}");

    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("moves focus to main when clicked", async () => {
    await renderVisit(visit("/", "member"));
    const user = userEvent.setup();

    await user.click(screen.getByRole("link", { name: "Skip to content" }));

    expect(document.activeElement).toBe(screen.getByRole("main"));
  });
});

describe("the brand link (criterion 4)", () => {
  function brandParts() {
    const brand = screen.getByRole("link", { name: "fanwire" });
    const picture = brand.querySelector("picture");
    const darkSource =
      picture?.querySelector('source[media="(prefers-color-scheme: dark)"]') ??
      null;
    const wordmark = picture?.querySelector("img") ?? null;
    const symbols = [...brand.querySelectorAll("img")].filter(
      (img) => picture === null || !picture.contains(img),
    );
    return { brand, picture, darkSource, wordmark, symbols };
  }

  it.each([
    visit("/", "anonymous"),
    visit("/", "member"),
    visit("/search", "anonymous"),
  ])(
    "is one link to / named exactly fanwire, in the header, at $path for a $as visitor",
    async (v) => {
      await renderVisit(v);
      const { brand } = brandParts();

      expect(pageBanner()).toContainElement(brand);
      expect(brand).toHaveAttribute("href", "/");
    },
  );

  it('holds the symbol as a decorative <img alt="">', async () => {
    await renderVisit(visit("/", "anonymous"));
    const { symbols } = brandParts();

    expect(symbols, "one <img> outside the <picture>: the symbol").toHaveLength(
      1,
    );
    expect(symbols[0]).toHaveAttribute("alt", "");
  });

  it('holds the wordmark as a <picture> with a dark <source> and an <img alt="fanwire">', async () => {
    await renderVisit(visit("/", "anonymous"));
    const { picture, darkSource, wordmark } = brandParts();

    expect(picture, "no <picture> inside the brand link").not.toBeNull();
    expect(
      darkSource,
      'no <source media="(prefers-color-scheme: dark)">',
    ).not.toBeNull();
    expect(darkSource?.getAttribute("srcset") ?? "").not.toBe("");
    expect(wordmark, "no <img> inside the <picture>").not.toBeNull();
    expect(wordmark).toHaveAttribute("alt", "fanwire");
  });

  it("draws them from src/assets/brand", async () => {
    // Imported here, not at the top, so a missing file fails this test alone.
    // Whatever the bundler makes of an import — a path or a data: URI — is
    // what the shell's own import of the same file renders.
    const names = ["symbol.svg", "wordmark-light.svg", "wordmark-dark.svg"];
    for (const name of names) {
      expect(
        existsSync(join(SRC_DIR, "assets", "brand", name)),
        `src/assets/brand/${name} must exist`,
      ).toBe(true);
    }
    const [symbolUrl, lightUrl, darkUrl] = await Promise.all(
      names.map(
        async (name) =>
          (await importLate<string>(`../assets/brand/${name}`)).default,
      ),
    );

    await renderVisit(visit("/", "anonymous"));
    const { darkSource, wordmark, symbols } = brandParts();

    expect(symbols[0]?.getAttribute("src")).toBe(symbolUrl);
    expect(wordmark?.getAttribute("src")).toBe(lightUrl);
    expect((darkSource?.getAttribute("srcset") ?? "").trim()).toMatch(
      new RegExp(`^${darkUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`),
    );
  });
});

describe("aria-current on the current route's nav link (criterion 5)", () => {
  const CASES: { path: string; as: Visitor; current: string | null }[] = [
    { path: "/", as: "anonymous", current: "Feed" },
    { path: "/search", as: "anonymous", current: "Search" },
    { path: "/", as: "member", current: "Feed" },
    { path: "/compose", as: "member", current: "Compose" },
    { path: "/notifications", as: "member", current: "Notifications" },
    { path: "/search", as: "member", current: "Search" },
    { path: OWN_PROFILE_PATH, as: "member", current: "Your profile" },
    // Someone else's profile, a page outside the nav, and a wrong address:
    // no nav link is the current page.
    { path: OTHER_PROFILE_PATH, as: "member", current: null },
    { path: "/sign-in", as: "anonymous", current: null },
    { path: "/no-such-page-exists", as: "anonymous", current: null },
  ];

  it.each(CASES)(
    "$path for a $as visitor marks $current and nothing else",
    async ({ path, as, current }) => {
      await renderVisit(visit(path, as));
      const nav = primaryNav();
      const names = navNamesFor(as);

      expect(within(nav).getAllByRole("link")).toHaveLength(names.length);
      const marked = names.filter(
        (name) =>
          within(nav)
            .getByRole("link", { name })
            .getAttribute("aria-current") === "page",
      );

      expect(marked).toEqual(current === null ? [] : [current]);
    },
  );
});

describe("nav link names and icons (criterion 6)", () => {
  it.each<Visitor>(["anonymous", "member"])(
    "keeps every name, in order, for a %s visitor",
    async (as) => {
      await renderVisit(visit("/", as));
      const nav = primaryNav();

      expect(within(nav).getAllByRole("link")).toEqual(
        navNamesFor(as).map((name) => within(nav).getByRole("link", { name })),
      );
    },
  );

  it.each(NAV_ITEMS)(
    "%s carries its aria-hidden icon from src/components/ui/icons",
    async (name, Icon) => {
      await renderVisit(visit("/", "member"));
      const link = within(primaryNav()).getByRole("link", { name });

      const icons = [...link.querySelectorAll("svg")];
      expect(icons, `no <svg> inside the ${name} link`).toHaveLength(1);
      expect(icons[0]).toHaveAttribute("aria-hidden", "true");
      expect(shapes(icons[0])).toEqual(referenceShapes(Icon));
    },
  );
});

describe("Sign in in the header (criterion 7)", () => {
  it.each(["/", "/search", OTHER_PROFILE_PATH])(
    "is offered to an anonymous visitor at %s, linking to /sign-in",
    async (path) => {
      await renderVisit(visit(path, "anonymous"));

      const signIn = within(pageBanner()).getByRole("link", {
        name: "Sign in",
      });
      expect(signIn).toHaveAttribute("href", "/sign-in");
      // Beside the nav, not one of its items: the nav keeps its own links.
      expect(primaryNav()).not.toContainElement(signIn);
    },
  );

  it.each(["/", "/search", OTHER_PROFILE_PATH, OWN_PROFILE_PATH])(
    "is not offered to a signed-in visitor with a profile at %s",
    async (path) => {
      await renderVisit(visit(path, "member"));

      expect(
        within(pageBanner()).queryByRole("link", {
          name: /sign\s*-?\s*in/i,
        }),
      ).toBeNull();
    },
  );
});

describe("the nav carries the shell module's fixed-to-bottom class (criterion 8)", () => {
  it("puts the class of the position: fixed; bottom: 0 rule on the <nav>", async () => {
    const css = readSrcFile("routes/AppLayout.module.css");
    const classes = topLevelFixedBottomRules(parseCss(css)).flatMap((rule) =>
      selectors(rule).flatMap(lastCompoundClasses),
    );
    expect(
      classes,
      "no class selector on a top-level fixed-to-bottom rule",
    ).not.toEqual([]);

    const { default: styles } = await importLate<Record<string, string>>(
      "./AppLayout.module.css",
    );
    await renderVisit(visit("/", "anonymous"));
    const nav = primaryNav();

    expect(
      classes.some((name) => nav.classList.contains(styles[name])),
      `the Primary <nav> carries none of ${classes.map((c) => `.${c}`).join(", ")}`,
    ).toBe(true);
  });
});
