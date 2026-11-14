/**
 * FRONTEND-040 — the game view loses its matchup artwork (the human's ask,
 * 2026-11-07: "those three are all perfect").
 *
 * - **On disk**: `features/games/MatchupArtwork.tsx` is gone, no file under
 *   `src/` (this one aside, which has to say what it looks for) imports or
 *   names it, and `Games.module.css` keeps no rule for its classes
 *   (`.matchupArtwork`, `.artLabels`, `.artTeam`, `.artDate`).
 * - **Rendered**, on the page and in the modal alike: the game's `<article>`
 *   has exactly the header, then the line score when the game has one, then
 *   the "Team box scores" tabs, and nothing else (no `<figure>`, nothing
 *   hidden from assistive technology between them). Checked with a game that
 *   has a line score and with one that has none.
 *
 * Nothing here imports the page component or the removed one: the page comes
 * through the real route table (`renderAppAt`), and the modal through the
 * feed's own post card, as `routes/detail-flow.test.tsx` opens it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderAppAt } from "../../test/app-route";
import {
  SRC_DIR,
  allBlocks,
  isAtRule,
  parseCss,
  readSrcFile,
  selectors,
} from "../../test/css";
import { feedPage, feedStub } from "../../test/feed";
import {
  gameDetailStub,
  testGameDetail,
  type GameDetailOut,
} from "../../test/games";
import {
  PREVIEW_GAME_ID,
  gameFinalPreview,
  linedGameDetail,
  postWithPreview,
} from "../../test/previews";
import { cardUnderneath, openDialog } from "../../test/thread";

const THIS_FILE = "no-matchup-artwork.test.tsx";
const REMOVED_NAME = "MatchupArtwork";
const REMOVED_CLASSES = ["matchupArtwork", "artLabels", "artTeam", "artDate"];

/* ------------------------------------------------------------------ disk */

/** Every source file under `src/`, as a path relative to it with `/`. */
function sourceFiles(directory: string = SRC_DIR): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      found.push(relative(SRC_DIR, full).split(sep).join("/"));
    }
  }
  return found;
}

describe("the matchup artwork is gone from disk", () => {
  it("has no features/games/MatchupArtwork.tsx", () => {
    expect(
      existsSync(join(SRC_DIR, "features", "games", "MatchupArtwork.tsx")),
    ).toBe(false);
  });

  it("is imported or named by no file under src", () => {
    const files = sourceFiles().filter((file) => basename(file) !== THIS_FILE);
    // Not vacuously green: the scan saw the game page itself.
    expect(files).toContain("features/games/GamePage.tsx");

    const naming = files.filter((file) =>
      readFileSync(join(SRC_DIR, ...file.split("/")), "utf8").includes(
        REMOVED_NAME,
      ),
    );
    expect(naming).toEqual([]);
  });

  it("leaves Games.module.css no rule for its classes", () => {
    const rules = allBlocks(
      parseCss(readSrcFile("features/games/Games.module.css")),
    ).filter((block) => !isAtRule(block));
    // Not vacuously green: the module's own rules are read.
    expect(rules.some((rule) => selectors(rule).includes(".page"))).toBe(true);

    const leftover = rules.flatMap((rule) =>
      selectors(rule).filter((selector) =>
        [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].some(([, name]) =>
          REMOVED_CLASSES.includes(name),
        ),
      ),
    );
    expect(leftover).toEqual([]);
  });
});

/* -------------------------------------------------------------- rendered */

const NO_LINE_SCORE = {
  home_line_score: null,
  away_line_score: null,
} as const;

/** The game's own `<article>`: the one holding the level-one heading. */
function gameArticle(root: HTMLElement): HTMLElement {
  const heading = within(root).getByRole("heading", { level: 1 });
  const article = heading.closest("article");
  if (article === null) throw new Error("the game heading is in no article");
  return article as HTMLElement;
}

function isHeader(element: Element): boolean {
  return (
    element.tagName === "HEADER" &&
    element.querySelector("h1") !== null &&
    element.querySelector("table") === null
  );
}

/** The line score: the region whose table's column headers start at Q1. */
function isLineScore(element: Element): boolean {
  const tables = [
    ...(element.matches("table") ? [element] : []),
    ...element.querySelectorAll("table"),
  ];
  return (
    tables.length === 1 &&
    [...tables[0].querySelectorAll("th")].some(
      (header) => header.textContent?.trim() === "Q1",
    ) &&
    element.querySelector('[role="tablist"]') === null
  );
}

function isTeamTabs(element: Element): boolean {
  const lists = [
    ...(element.matches('[role="tablist"]') ? [element] : []),
    ...element.querySelectorAll('[role="tablist"]'),
  ];
  return (
    lists.length === 1 &&
    lists[0].getAttribute("aria-label") === "Team box scores"
  );
}

/** What each of the article's children is, in order. */
function childKinds(article: HTMLElement): string[] {
  return [...article.children].map((child) => {
    if (isHeader(child)) return "header";
    if (isLineScore(child)) return "line score";
    if (isTeamTabs(child)) return "team tabs";
    return `other <${child.tagName.toLowerCase()}${
      child.className === "" ? "" : ` class="${String(child.className)}"`
    }>`;
  });
}

function expectOnlyThePerfectThree(
  article: HTMLElement,
  withLineScore: boolean,
): void {
  expect(childKinds(article)).toEqual(
    withLineScore
      ? ["header", "line score", "team tabs"]
      : ["header", "team tabs"],
  );
  expect(article.querySelectorAll("figure")).toHaveLength(0);
  expect(article.querySelectorAll("figcaption")).toHaveLength(0);
}

const originalScrollIntoView = Element.prototype.scrollIntoView;
let scrollTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  scrollTo.mockRestore();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("the game page's article: header, line score, team tabs", () => {
  async function openPage(game: GameDetailOut): Promise<HTMLElement> {
    renderAppAt(`/games/${game.id}`, "anonymous", [
      gameDetailStub([game]).handler,
    ]);
    const main = screen.getByRole("main");
    await within(main).findByRole("tablist", { name: "Team box scores" });
    return gameArticle(main);
  }

  it("is the header, the line score and the tabs, in that order, for a game with a line score", async () => {
    const article = await openPage(testGameDetail());

    expectOnlyThePerfectThree(article, true);
  });

  it("is the header and the tabs, in that order, for a game with no line score", async () => {
    const article = await openPage(testGameDetail(NO_LINE_SCORE));

    expectOnlyThePerfectThree(article, false);
  });
});

describe("the game in the modal: the same three, nothing else", () => {
  const POST_TEXT = "Raptors in six";
  const GAME_HREF = `/games/${PREVIEW_GAME_ID}`;

  async function openModal(game: GameDetailOut): Promise<HTMLElement> {
    const user = userEvent.setup();
    const post = postWithPreview(gameFinalPreview(), {
      id: 101,
      text: POST_TEXT,
    });
    const app = renderAppAt("/", "anonymous", [
      feedStub([feedPage([post], null)]).handler,
      gameDetailStub([game]).handler,
    ]);
    await screen.findByText(POST_TEXT);

    const links = [
      ...cardUnderneath(POST_TEXT).querySelectorAll<HTMLAnchorElement>(
        "a[href]",
      ),
    ].filter((link) => link.getAttribute("href") === GAME_HREF);
    expect(links, `the card links to ${GAME_HREF}`).not.toEqual([]);
    await user.click(links[0]);

    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe(GAME_HREF),
    );
    const dialog = await waitFor(() => {
      const open = openDialog();
      if (open === null) throw new Error("no dialog is open");
      return open;
    });
    await within(dialog).findByRole("tablist", { name: "Team box scores" });
    return gameArticle(dialog);
  }

  it("is the header, the line score and the tabs, in that order, for a game with a line score", async () => {
    const article = await openModal(linedGameDetail());

    expectOnlyThePerfectThree(article, true);
  });

  it("is the header and the tabs, in that order, for a game with no line score", async () => {
    const article = await openModal(linedGameDetail(NO_LINE_SCORE));

    expectOnlyThePerfectThree(article, false);
  });
});
