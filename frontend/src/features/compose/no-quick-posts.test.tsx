/**
 * FRONTEND-040 — the composer loses its Quick posts section (the human's ask,
 * 2026-11-07: "it's useless and the messages are corny").
 *
 * - **Rendered**, on the page (`ComposePage` alone) and in the modal (a direct
 *   load of `/compose`, which opens the dialog over the feed): no "Quick
 *   posts" heading and none of the three template buttons. The template names
 *   are written out here because the module that held them is to be deleted.
 * - **On disk**: `features/compose/PostTemplate.ts` is gone,
 *   `ComposeMediator` has no `loadDraft` (templates were its only caller),
 *   `ComposePage.module.css` keeps no rule for the section (`.quick`,
 *   `.templates`), and no file under `src/` (this one aside) still names the
 *   templates or describes quick posts in a comment.
 *
 * Every other composer path is pinned by the composer's existing tests, which
 * this unit leaves unedited.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderAppAt } from "../../test/app-route";
import { renderWithAuth } from "../../test/auth";
import {
  SRC_DIR,
  allBlocks,
  isAtRule,
  parseCss,
  readSrcFile,
  selectors,
} from "../../test/css";
import { ComposeMediator } from "./ComposeMediator";
import { ComposePage } from "./ComposePage";

const THIS_FILE = "no-quick-posts.test.tsx";
const TEMPLATE_NAMES = [
  "Final score reaction",
  "Pre-game hype",
  "Player watch",
];
const REMOVED_CLASSES = ["quick", "templates"];

/** What the section was called, and what its code and comments named. */
const QUICK_POST_WORDING =
  /PostTemplate|QUICK_POST_TEMPLATES|loadDraft|quick[- ]?posts?\b/i;

function expectNoQuickPosts(root: HTMLElement): void {
  expect(
    within(root).queryByRole("heading", { name: /quick posts?/i }),
  ).toBeNull();
  expect(within(root).queryByText(/quick posts?/i)).toBeNull();
  for (const name of TEMPLATE_NAMES) {
    expect(within(root).queryByRole("button", { name }), name).toBeNull();
    expect(within(root).queryByText(name), name).toBeNull();
  }
}

describe("the composer page has no Quick posts section", () => {
  it("shows no Quick posts heading and no template button", async () => {
    renderWithAuth(<ComposePage />, { route: "/compose" });
    const box = await screen.findByRole("textbox", { name: /post/i });
    // Not vacuously green: the composer itself is there.
    expect(box).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post" })).toBeInTheDocument();

    expectNoQuickPosts(document.body);
  });
});

describe("the composer modal has no Quick posts section", () => {
  let scrollTo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    scrollTo.mockRestore();
  });

  it("shows no Quick posts heading and no template button in the Compose dialog", async () => {
    renderAppAt("/compose", "member");
    const dialog = await screen.findByRole("dialog", { name: "Compose" });
    await within(dialog).findByRole("textbox", { name: /post/i });
    expect(
      within(dialog).getByRole("button", { name: "Post" }),
    ).toBeInTheDocument();

    expectNoQuickPosts(dialog);
  });
});

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

describe("the quick-post templates are gone from disk", () => {
  it("has no features/compose/PostTemplate.ts", () => {
    expect(
      existsSync(join(SRC_DIR, "features", "compose", "PostTemplate.ts")),
    ).toBe(false);
  });

  it("leaves ComposeMediator no loadDraft", () => {
    // Not vacuously green: the mediator's other methods are there.
    expect(typeof ComposeMediator.prototype.reset).toBe("function");
    expect("loadDraft" in ComposeMediator.prototype).toBe(false);
  });

  it("leaves ComposePage.module.css no rule for the section", () => {
    const rules = allBlocks(
      parseCss(readSrcFile("features/compose/ComposePage.module.css")),
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

  it("is named, or described in a comment, by no file under src", () => {
    const files = sourceFiles().filter((file) => basename(file) !== THIS_FILE);
    // Not vacuously green: the scan saw the composer itself.
    expect(files).toContain("features/compose/ComposePage.tsx");

    const naming = files.flatMap((file) => {
      const lines = readFileSync(join(SRC_DIR, ...file.split("/")), "utf8")
        .replace(/\r/g, "")
        .split("\n");
      return lines.flatMap((line, index) => {
        // A comment's wording may break over two lines ("the quick" / "posts").
        const next = (lines[index + 1] ?? "").replace(/^\s*(\*|\/\/)?\s*/, "");
        return QUICK_POST_WORDING.test(line) ||
          (QUICK_POST_WORDING.test(`${line.trimEnd()} ${next}`) &&
            !QUICK_POST_WORDING.test(next))
          ? [`${file}:${index + 1}: ${line.trim()}`]
          : [];
      });
    });
    expect(naming).toEqual([]);
  });
});
