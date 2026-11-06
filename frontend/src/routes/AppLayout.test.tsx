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
 * **FRONTEND-035** moved the nav out of the header: it is a sibling after the
 * header and before `main` (the phone bar, then the left sidebar from 40em),
 * "Feed" became "Home", the order is Home, Stats, Search, Notifications, and
 * Sign out left the header to become the nav's last item. Search also has an
 * icon link in the header for phones, so a whole-page query for a Search link
 * is ambiguous: the nav's is always looked up `within()` the nav. The new
 * shape and its CSS are pinned in `sidebar-nav.test.tsx`.
 *
 * The Sign in link is asserted inside the banner only. `/confirm` and
 * `/forgot-password` carry their own "Back to sign in" link, so a whole-page
 * query for a sign-in link would be ambiguous there; scoping to the banner
 * pins the header's link and nothing else.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "../api/client";
import type { AuthService } from "../auth/AuthService";
import {
  BellIcon,
  ChartColumnIcon,
  HouseIcon,
  SearchIcon,
  type IconProps,
} from "../components/ui/icons";
import { deactivatedShown } from "../test/account";
import { OWN_USER_ID, renderAppAt, type Visitor } from "../test/app-route";
import { TEST_ID_TOKEN, testProfile, type FakeAuthService } from "../test/auth";
import { SRC_DIR, parseCss, readSrcFile, selectors } from "../test/css";
import { feedPage, testPostView } from "../test/feed";
import {
  lastCompoundClasses,
  topLevelFixedBottomRules,
} from "../test/module-css";
import { notificationsStub } from "../test/notifications";
import { testPlayerDetail } from "../test/stats";
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
/** FRONTEND-009's player page, for the player `statsDefaults()` knows. */
const PLAYER_PATH = `/players/${testPlayerDetail().id}`;
const PLAYER_HEADING = exactly(
  `${testPlayerDetail().first_name} ${testPlayerDetail().last_name}`,
);

/**
 * Every route in the table, for every visitor its guards let render it, plus
 * the signed-in member on each public route, and on their own profile.
 */
const VISITS: Visit[] = [
  { path: "/", as: "anonymous", heading: /^feed$/i },
  { path: "/search", as: "anonymous", heading: /^search$/i },
  // FRONTEND-009's routes: public, one Stats heading above both tabs.
  { path: "/stats/seasons", as: "anonymous", heading: /^stats$/i },
  { path: "/stats/players", as: "anonymous", heading: /^stats$/i },
  { path: PLAYER_PATH, as: "anonymous", heading: PLAYER_HEADING },
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
  { path: "/stats/seasons", as: "member", heading: /^stats$/i },
  { path: PLAYER_PATH, as: "member", heading: PLAYER_HEADING },
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
 * for a member, for the account menu that only appears once `GET /users/me`
 * has answered, so the whole shell is on screen.
 */
async function renderVisit({ path, as, heading }: Visit): Promise<void> {
  renderAppAt(path, as);
  await screen.findByRole("heading", { name: heading });
  if (as === "member") {
    await within(pageBanner()).findByRole("button", { name: "Account menu" });
  }
}

const NAV_ITEMS: [string, ComponentType<IconProps>][] = [
  // FRONTEND-035: "Feed" is renamed "Home", and the order is Home, Stats,
  // Search, Notifications (Sign out, a button, follows them in the list).
  ["Home", HouseIcon],
  // FRONTEND-020: Compose left the nav for the floating + (compose-modal.test.tsx).
  // FRONTEND-009: account destinations live in the menu.
  ["Stats", ChartColumnIcon],
  ["Search", SearchIcon],
  ["Notifications", BellIcon],
];

function navNamesFor(): string[] {
  return NAV_ITEMS.map(([name]) => name);
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
 * A literal `import("../assets/brand/wordmark-light.png")` is resolved when this file
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
      // FRONTEND-035: no longer inside the header. After it and before main,
      // in neither: the bottom bar on phones, the left sidebar from 40em.
      const header = pageBanner();
      expect(header).not.toContainElement(navs[0]);
      expect(mains[0]).not.toContainElement(navs[0]);
      expect(
        header.compareDocumentPosition(navs[0]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        "the nav follows the header",
      ).toBeTruthy();
      expect(
        navs[0].compareDocumentPosition(mains[0]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        "main follows the nav",
      ).toBeTruthy();
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
    await renderVisit(visit("/search", "anonymous"));
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

  it("holds no symbol: the wordmark is the brand link's only image", async () => {
    await renderVisit(visit("/", "anonymous"));
    const { brand, symbols } = brandParts();

    expect(symbols, "an <img> outside the <picture>").toHaveLength(0);
    expect(brand.querySelectorAll("img")).toHaveLength(1);
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
    const names = ["wordmark-light.png", "wordmark-dark.png"];
    for (const name of names) {
      expect(
        existsSync(join(SRC_DIR, "assets", "brand", name)),
        `src/assets/brand/${name} must exist`,
      ).toBe(true);
    }
    const [lightUrl, darkUrl] = await Promise.all(
      names.map(
        async (name) =>
          (await importLate<string>(`../assets/brand/${name}`)).default,
      ),
    );

    await renderVisit(visit("/", "anonymous"));
    const { darkSource, wordmark } = brandParts();

    expect(wordmark?.getAttribute("src")).toBe(lightUrl);
    expect((darkSource?.getAttribute("srcset") ?? "").trim()).toMatch(
      new RegExp(`^${darkUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`),
    );
  });
});

describe("aria-current on the current route's nav link (criterion 5)", () => {
  const CASES: { path: string; as: Visitor; current: string | null }[] = [
    { path: "/", as: "anonymous", current: "Home" },
    { path: "/search", as: "anonymous", current: "Search" },
    { path: "/", as: "member", current: "Home" },
    // FRONTEND-020: compose is a dialog over the feed, and no nav item is the
    // current page under an overlay (as under the thread modal).
    { path: "/compose", as: "member", current: null },
    { path: "/notifications", as: "member", current: "Notifications" },
    { path: "/search", as: "member", current: "Search" },
    // FRONTEND-009: Stats is current on every /stats and /players route.
    { path: "/stats/seasons", as: "anonymous", current: "Stats" },
    { path: "/stats/players", as: "anonymous", current: "Stats" },
    { path: PLAYER_PATH, as: "anonymous", current: "Stats" },
    { path: "/stats/seasons", as: "member", current: "Stats" },
    { path: PLAYER_PATH, as: "member", current: "Stats" },
    { path: OWN_PROFILE_PATH, as: "member", current: null },
    // Own/other profiles, a page outside the nav, and a wrong address:
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
      const names = navNamesFor();

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
        navNamesFor().map((name) => within(nav).getByRole("link", { name })),
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

/**
 * FRONTEND-027: Sign out. Who sees it, where it sits, and what pressing it
 * leaves behind. FRONTEND-035 moved it from the header into the Primary nav,
 * as the list's last item, under the same rule: a restored session whose
 * account is not deactivated. The header has no Sign out any more.
 */
describe("Sign out in the nav", () => {
  function navSignOut(): HTMLElement | null {
    return within(primaryNav()).queryByRole("button", { name: "Sign out" });
  }

  function pageSignOuts(): HTMLElement[] {
    return screen.queryAllByRole("button", { name: "Sign out" });
  }

  afterEach(() => {
    setTokenProvider(() => null);
  });

  it.each([
    visit("/", "member"),
    visit("/search", "member"),
    visit(OWN_PROFILE_PATH, "member"),
    visit("/create-profile", "newcomer"),
  ])(
    "is the page's one Sign out, the nav list's last item, at $path for a $as visitor",
    async (v) => {
      await renderVisit(v);

      const button = await within(primaryNav()).findByRole("button", {
        name: "Sign out",
      });

      expect(pageSignOuts()).toEqual([button]);
      expect(button.tagName).toBe("BUTTON");
      expect(pageBanner()).not.toContainElement(button);
      const items = within(primaryNav()).getAllByRole("listitem");
      expect(items[items.length - 1]).toContainElement(button);
      expect(button).not.toHaveAttribute("aria-current");
      expect(tabbables()[0]).toBe(
        screen.getByRole("link", { name: "Skip to content" }),
      );
    },
  );

  it.each([
    visit("/", "member"),
    visit("/create-profile", "newcomer"),
    visit("/", "anonymous"),
  ])("is never in the header: $path for a $as visitor", async (v) => {
    await renderVisit(v);

    expect(
      within(pageBanner()).queryByRole("button", { name: "Sign out" }),
    ).toBeNull();
  });

  it("is offered when the profile could not be read: the visitor still has a way out", async () => {
    renderAppAt("/", "member", [
      http.get("*/users/me", () =>
        HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 }),
      ),
    ]);

    const button = await within(primaryNav()).findByRole("button", {
      name: "Sign out",
    });

    expect(pageSignOuts()).toEqual([button]);
    expect(
      within(primaryNav()).queryByRole("link", { name: "Your profile" }),
    ).toBeNull();
  });

  it.each(["/", "/search", OTHER_PROFILE_PATH])(
    "is not offered to an anonymous visitor at %s",
    async (path) => {
      await renderVisit(visit(path, "anonymous"));

      expect(pageSignOuts()).toEqual([]);
    },
  );

  it("is not offered while the session is being restored", async () => {
    renderAppAt("/", "member");

    // The first commit: the session has not been answered yet.
    expect(pageSignOuts()).toEqual([]);

    // And it does arrive, so the line above is not vacuously true.
    expect(
      await within(primaryNav()).findByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("is not offered to a deactivated account, whose banner has the one Sign out (none in the nav)", async () => {
    renderAppAt("/", "deactivated");
    const banner = await deactivatedShown();

    expect(navSignOut()).toBeNull();
    expect(pageSignOuts()).toEqual([
      within(banner).getByRole("button", { name: "Sign out" }),
    ]);
  });

  it("is not offered to a deactivated account on a signed-in-only route either", async () => {
    renderAppAt("/notifications", "deactivated");
    await deactivatedShown();

    expect(navSignOut()).toBeNull();
  });

  it("signs out once on a public route: same address, Sign in offered, focus on main", async () => {
    const user = userEvent.setup();
    const app = renderAppAt("/search", "member");
    const button = await within(primaryNav()).findByRole("button", {
      name: "Sign out",
    });

    await user.click(button);

    expect(
      (app.authService as FakeAuthService).callsTo("signOut"),
    ).toHaveLength(1);
    expect(app.router.state.location.pathname).toBe("/search");
    expect(
      await within(pageBanner()).findByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/sign-in");
    expect(pageSignOuts()).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("on a signed-in-only route lands on /sign-in through the guard, focus on main", async () => {
    const user = userEvent.setup();
    const app = renderAppAt("/notifications", "member");
    const button = await within(primaryNav()).findByRole("button", {
      name: "Sign out",
    });

    await user.click(button);

    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/sign-in"),
    );
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("asks nothing as a guest of the signed-in-only page it is leaving", async () => {
    const user = userEvent.setup();
    const notifications = notificationsStub();
    const app = renderAppAt("/notifications", "member", [
      notifications.handler,
    ]);
    await screen.findByRole("heading", { name: /^notifications$/i });
    const button = await within(primaryNav()).findByRole("button", {
      name: "Sign out",
    });
    await waitFor(() => expect(notifications.requests).toHaveLength(1));

    await user.click(button);
    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/sign-in"),
    );
    // Long enough for a refetch that was going to happen to reach the stub.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(notifications.requests).toHaveLength(1);
  });

  it("reads a mounted feed again as a guest, with nothing of the member's left pressed", async () => {
    const user = userEvent.setup();
    const authorizations: (string | null)[] = [];
    let releaseGuest = () => {};
    const guestMayAnswer = new Promise<void>((resolve) => {
      releaseGuest = resolve;
    });
    let authService: AuthService | null = null;
    // The app's real wiring (`tokenProvider.ts`), once the double exists; the
    // shell's first read goes out before `renderAppAt` hands the double back.
    setTokenProvider(() =>
      authService === null ? TEST_ID_TOKEN : authService.getIdToken(),
    );

    const app = renderAppAt("/", "member", [
      http.get("*/feed", async ({ request }) => {
        const authorization = request.headers.get("Authorization");
        authorizations.push(authorization);
        if (authorization === null) await guestMayAnswer;
        const asMember = authorization !== null;
        return HttpResponse.json(
          feedPage([
            testPostView({
              liked_by_viewer: asMember,
              reposted_by_viewer: asMember,
            }),
          ]),
        );
      }),
    ]);
    authService = app.authService;

    const liked = await screen.findByRole("button", { name: "Like" });
    await waitFor(() => expect(liked).toHaveAttribute("aria-pressed", "true"));
    const button = await within(primaryNav()).findByRole("button", {
      name: "Sign out",
    });

    await user.click(button);

    // The guest's answer is still held: the member's one must be gone already.
    await waitFor(() => expect(authorizations.at(-1)).toBeNull());
    expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);

    releaseGuest();
    const guestLike = await screen.findByRole("button", { name: "Like" });
    expect(guestLike).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Repost" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(app.router.state.location.pathname).toBe("/");
  });
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

/**
 * FRONTEND-030: the content column. `main`'s width is `--content-max`
 * (40rem) on every route but `/stats/records`, where it is
 * `--content-max-wide` (64rem), so the records home's cards fit three to a
 * row. AppLayout chooses it from the route; the shell's module holds both
 * rules (`shell-css.test.ts`).
 *
 * jsdom computes no styles, so `main`'s max-width is resolved here from the
 * shell's module: every rule (outside a max-width query) whose selector
 * matches the rendered `main`, once its module class names are mapped to the
 * generated ones, the most specific and then the last winning, as the
 * cascade does; an inline `max-width` beats them all.
 */
describe("the content column: wide on the records home only (FRONTEND-030)", () => {
  function specificity(selector: string): number {
    const ids = (selector.match(/#[\w-]+/g) ?? []).length;
    const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? [])
      .length;
    const elements = (
      selector.replace(/[.#:[][^\s>+~]*/g, " ").match(/\b[a-z][\w-]*/gi) ?? []
    ).length;
    return ids * 10_000 + classes * 100 + elements;
  }

  async function mainMaxWidth(): Promise<string | undefined> {
    const { default: styles } = await importLate<Record<string, string>>(
      "./AppLayout.module.css",
    );
    const main = screen.getByRole("main");
    const inline = main.style.getPropertyValue("max-width");
    if (inline !== "") return inline.replace(/\s+/g, "");

    let winner: { value: string; weight: number } | undefined;
    const css = parseCss(readSrcFile("routes/AppLayout.module.css"));
    const walk = (blocks: ReturnType<typeof parseCss>, applies: boolean) => {
      for (const block of blocks) {
        if (/^@/.test(block.prelude)) {
          const media = /^@media\b/i.test(block.prelude);
          const narrowOnly =
            /max-width|\bwidth\s*<|>\s*=?\s*width\b|prefers-|print/i.test(
              block.prelude,
            );
          walk(block.children, applies && media && !narrowOnly);
          continue;
        }
        if (applies) {
          const value = block.declarations
            .filter((d) => d.property === "max-width")
            .map((d) => d.value.replace(/\s+/g, ""))
            .pop();
          if (value !== undefined) {
            for (const selector of selectors(block)) {
              const generated = selector
                .replace(/:global\(([^)]*)\)/g, "$1")
                .replace(/\.(-?[_a-zA-Z][\w-]*)/g, (_, name: string) =>
                  styles[name] === undefined ? `.${name}` : `.${styles[name]}`,
                );
              let matches = false;
              try {
                matches = main.matches(generated);
              } catch {
                matches = false;
              }
              const weight = specificity(selector);
              if (matches && (winner === undefined || weight >= winner.weight))
                winner = { value, weight };
            }
          }
        }
        walk(block.children, applies);
      }
    };
    walk(css, true);
    return winner?.value;
  }

  it("AppLayout chooses the column from the route", () => {
    expect(readSrcFile("routes/AppLayout.tsx")).toMatch(
      /["'`]\/stats\/records/,
    );
  });

  it.each([
    "/stats/records",
    "/stats/records?group=team",
    "/stats/records?q=3pt",
    "/stats/records?record=team-best-season",
  ])("%s: main is var(--content-max-wide)", async (path) => {
    renderAppAt(path, "anonymous");
    await screen.findByRole("heading", { name: /^stats$/i });

    expect(await mainMaxWidth()).toBe("var(--content-max-wide)");
  });

  it.each([
    ["/", "anonymous"],
    ["/search", "anonymous"],
    ["/stats/seasons", "anonymous"],
    ["/stats/players", "anonymous"],
    [PLAYER_PATH, "anonymous"],
    ["/sign-in", "anonymous"],
    ["/no-such-page-exists", "anonymous"],
    ["/notifications", "member"],
    [OWN_PROFILE_PATH, "member"],
  ] as [string, Visitor][])(
    "%s (%s): main keeps var(--content-max)",
    async (path, as) => {
      await renderVisit(visit(path, as));

      expect(await mainMaxWidth()).toBe("var(--content-max)");
    },
  );

  it("leaving /stats/records for another stats tab narrows main again", async () => {
    const { router } = renderAppAt("/stats/records", "anonymous");
    await screen.findByRole("heading", { name: /^stats$/i });
    expect(await mainMaxWidth()).toBe("var(--content-max-wide)");

    await router.navigate("/stats/seasons");

    await waitFor(async () =>
      expect(await mainMaxWidth()).toBe("var(--content-max)"),
    );
  });
});

describe("the floating compose control", () => {
  const COMPOSE = "Compose a post";

  function queryCompose(): HTMLElement | null {
    return screen.queryByRole("button", { name: COMPOSE });
  }

  const inviteName = ["In", "vite"].join("");
  const copiedStatus = ["Cop", "ied"].join("");
  const linkCopiedStatus = ["Link ", "copied"].join("");

  it.each(VISITS)(
    "shows no removed floating control or copy status at $path for a $as visitor",
    async (v) => {
      await renderVisit(v);

      expect(screen.queryByRole("button", { name: inviteName })).toBeNull();
      expect(screen.queryByText(new RegExp(copiedStatus, "i"))).toBeNull();
      expect(screen.queryByText(new RegExp(linkCopiedStatus, "i"))).toBeNull();
    },
  );

  it.each(["/", "/notifications"])(
    "shows no removed floating control or copy status at %s for a deactivated account",
    async (path) => {
      renderAppAt(path, "deactivated");
      await deactivatedShown();

      expect(screen.queryByRole("button", { name: inviteName })).toBeNull();
      expect(screen.queryByText(new RegExp(copiedStatus, "i"))).toBeNull();
      expect(screen.queryByText(new RegExp(linkCopiedStatus, "i"))).toBeNull();
    },
  );

  it("removes the old component and all source references to it", () => {
    const componentName = ["Invite", "Button"].join("");
    const linkIconName = ["Link", "Icon"].join("");
    const componentFile = `${componentName}.tsx`;
    const walk = (directory: string): string[] =>
      readdirSync(directory).flatMap((entry) => {
        const fullPath = join(directory, entry);
        if (statSync(fullPath).isDirectory()) return walk(fullPath);
        return /\.tsx?$/.test(entry) ? [fullPath] : [];
      });
    const files = walk(SRC_DIR);
    const references = files.flatMap((file) => {
      const contents = readFileSync(file, "utf8");
      return [componentName, linkIconName]
        .filter((name) => contents.includes(name))
        .map((name) => `${file}: ${name}`);
    });

    expect(existsSync(join(SRC_DIR, "components", "ui", componentFile))).toBe(
      false,
    );
    expect(references).toEqual([]);
  });

  it.each(VISITS)(
    "keeps compose available only to an active member: $path for $as",
    async (v) => {
      await renderVisit(v);

      expect(queryCompose() !== null).toBe(v.as === "member");
    },
  );

  it.each<[Visitor, string]>([
    ["anonymous", "/"],
    ["anonymous", "/search"],
    ["deactivated", "/"],
    ["deactivated", "/notifications"],
  ])("is absent for a %s visitor at %s, as compose is", async (as, path) => {
    renderAppAt(path, as);
    if (as === "anonymous") {
      await within(pageBanner()).findByRole("link", { name: "Sign in" });
    } else {
      await deactivatedShown();
    }

    expect(queryCompose()).toBeNull();
  });

  it("is absent for a profile-less account, as compose is", async () => {
    await renderVisit(visit("/create-profile", "newcomer"));

    expect(queryCompose()).toBeNull();
  });

  it("is absent while the session is being restored, as compose is", async () => {
    renderAppAt("/", "member");

    expect(queryCompose()).toBeNull();
    // The session resolves and compose becomes available.
    await within(pageBanner()).findByRole("button", { name: "Account menu" });
    expect(queryCompose()).not.toBeNull();
  });

  it("keeps compose outside main, the header and the nav, after main in the tab order", async () => {
    await renderVisit(visit("/", "member"));
    const compose = screen.getByRole("button", { name: COMPOSE });

    expect(compose).toHaveAttribute("type", "button");
    expect(screen.getByRole("main")).not.toContainElement(compose);
    expect(pageBanner()).not.toContainElement(compose);
    expect(primaryNav()).not.toContainElement(compose);
    expect(
      screen.getByRole("main").compareDocumentPosition(compose) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const order = tabbables();
    expect(order.at(-1)).toBe(compose);
  });

  it("tabs from the last nav item into main, then reaches compose after main", async () => {
    await renderVisit(visit("/search", "member"));
    const main = screen.getByRole("main");
    const mainTabStops = [...main.querySelectorAll(FOCUSABLE)].filter(
      (element) =>
        element.getAttribute("tabindex") !== "-1" &&
        !element.hasAttribute("disabled"),
    );
    expect(mainTabStops.length).toBeGreaterThan(0);
    const compose = screen.getByRole("button", { name: COMPOSE });
    const user = userEvent.setup();

    const lastNavItem = within(primaryNav()).getByRole("button", {
      name: "Sign out",
    });
    lastNavItem.focus();
    await user.tab();
    expect(document.activeElement).toBe(mainTabStops[0]);
    mainTabStops.at(-1)?.focus();
    await user.tab();
    expect(document.activeElement).toBe(compose);
  });

  it("keeps the compose dialog flow anchored to the floating control", async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    try {
      await renderVisit(visit("/", "member"));
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: COMPOSE }));
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByRole("heading", { name: /^compose$/i });

      expect(showModal).toHaveBeenCalled();
      expect(dialog).toContainElement(
        within(dialog).getByRole("heading", { name: /^compose$/i }),
      );
    } finally {
      showModal.mockRestore();
    }
  });
});
