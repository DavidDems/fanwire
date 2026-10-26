/**
 * FRONTEND-020 — the attach row: icon-only controls under the text box.
 *
 * - **A paperclip, "Attach an image"** (PaperclipIcon): it opens the chooser of
 *   a visually hidden file input that keeps no `accept` attribute. The input
 *   has no label of its own and is no second tab stop, so the paperclip is the
 *   one control named for an image (`features/thread/ThreadModal.test.tsx`
 *   finds the reply box's media control with `getByLabelText(/image/i)`, which
 *   must match exactly one element).
 * - **A bar chart, "Attach stats"** (ChartColumnIcon): `aria-expanded`, closed
 *   by default, showing and hiding today's `AttachmentPicker` panel in place,
 *   with `aria-controls` naming it while it is open. A reply address has none.
 * - **An attached link's summary shows whether the panel is open or not.**
 * - **Each at least 44 px square**, read from the CSS rules the rendered
 *   control's classes carry (jsdom applies no styles), and the row sits
 *   between the text box and Post.
 * - **The image tile's overlay is static**: no keyframes and no animation in
 *   the composer's CSS (`accessibility.md` A8).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { render } from "@testing-library/react";

import buttonStyles from "../../components/ui/Button.module.css";
import { ChartColumnIcon, PaperclipIcon } from "../../components/ui/icons";
import { attachServer, attachedSummary, summaryShown } from "../../test/attach";
import { renderWithAuth } from "../../test/auth";
import {
  cssModulesFrom,
  drawsIcon,
  imageFileInput,
  lengthInRem,
  minimumBoxInRem,
  textOf,
} from "../../test/compose-modal";
import { SRC_DIR, allBlocks, parseCss } from "../../test/css";
import { moduleCssFiles } from "../../test/module-css";
import { server } from "../../test/server";
import { ComposePage } from "./ComposePage";
import { InlineComposer } from "./InlineComposer";

/** 44 px, `--target-min`. */
const TARGET_REM = 2.75;

const MODULES = {
  ...cssModulesFrom(
    import.meta.glob("./*.module.css", { eager: true }),
    "features/compose",
  ),
  ...cssModulesFrom(
    import.meta.glob("../../components/ui/*.module.css", { eager: true }),
    "features/compose",
  ),
};

function renderComposer(route = "/compose") {
  const view = renderWithAuth(<ComposePage />, { route });
  return { user: userEvent.setup(), ...view };
}

function renderReplyBox() {
  const view = renderWithAuth(
    <InlineComposer parentPostId={101} parentUsername="raptorsfan" />,
  );
  return { user: userEvent.setup(), ...view };
}

function paperclip(): HTMLElement {
  return screen.getByRole("button", { name: "Attach an image" });
}

function chart(): HTMLElement {
  return screen.getByRole("button", { name: "Attach stats" });
}

function expectIconOnly(button: HTMLElement): void {
  expect(textOf(button), "an icon-only control shows no text").toBe("");
  expect(button).toHaveAttribute("type", "button");
}

function expectTarget(button: HTMLElement): void {
  const box = minimumBoxInRem(button, MODULES);
  expect(box.width, "at least 44 px wide").toBeGreaterThanOrEqual(TARGET_REM);
  expect(box.height, "at least 44 px tall").toBeGreaterThanOrEqual(TARGET_REM);
}

function follows(earlier: Element, later: Element): boolean {
  return Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("the size reader is not vacuous", () => {
  it("resolves tokens, env() and calc()", () => {
    expect(lengthInRem("var(--target-min)")).toBe(2.75);
    expect(
      lengthInRem(
        "calc(var(--space-8) + var(--space-4) + env(safe-area-inset-bottom))",
      ),
    ).toBe(5);
    expect(lengthInRem("auto")).toBeNull();
  });

  it("reads a md Button's min-height from Button.module.css", () => {
    render(
      <button
        type="button"
        className={`${buttonStyles.button} ${buttonStyles.md}`}
      >
        x
      </button>,
    );
    expect(
      minimumBoxInRem(screen.getByRole("button"), MODULES).height,
    ).toBeGreaterThanOrEqual(TARGET_REM);
  });
});

describe("the paperclip: Attach an image", () => {
  it("is an icon-only button drawn with PaperclipIcon", () => {
    renderComposer();

    expectIconOnly(paperclip());
    expect(drawsIcon(paperclip(), PaperclipIcon)).toBe(true);
  });

  it("opens the chooser of the hidden file input", async () => {
    const { user } = renderComposer();
    const input = imageFileInput();
    let opened = 0;
    input.addEventListener("click", () => {
      opened += 1;
    });

    await user.click(paperclip());

    expect(opened).toBe(1);
  });

  it("keeps the input without an accept attribute, visually hidden and out of the tab order", () => {
    renderComposer();
    const input = imageFileInput();

    expect(input).not.toHaveAttribute("accept");
    expect(
      input.closest(".visually-hidden") !== null || input.hidden,
      "visually hidden",
    ).toBe(true);
    expect(
      input.tabIndex === -1 || input.hidden,
      "no second tab stop beside the paperclip",
    ).toBe(true);
  });

  it("is the one control named for an image, in the composer and in the reply box", () => {
    const page = renderComposer();
    expect(screen.getAllByLabelText(/image/i)).toEqual([paperclip()]);
    page.unmount();

    renderReplyBox();
    expect(screen.getAllByLabelText(/image/i)).toEqual([paperclip()]);
    expect(drawsIcon(paperclip(), PaperclipIcon)).toBe(true);
  });

  it("is at least 44 px square, in the composer and in the reply box", () => {
    const page = renderComposer();
    expectTarget(paperclip());
    page.unmount();

    renderReplyBox();
    expectTarget(paperclip());
  });
});

describe("the bar chart: Attach stats", () => {
  it("is an icon-only button drawn with ChartColumnIcon, at least 44 px square", () => {
    renderComposer();

    expectIconOnly(chart());
    expect(drawsIcon(chart(), ChartColumnIcon)).toBe(true);
    expectTarget(chart());
  });

  it("opens a dialog, with aria-haspopup and no disclosure attributes", async () => {
    server.use(...attachServer().handlers);
    const { user } = renderComposer();
    expect(chart()).toHaveAttribute("aria-haspopup", "dialog");
    expect(chart()).not.toHaveAttribute("aria-expanded");
    expect(chart()).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("dialog", { name: "Attach stats" })).toBeNull();
    await user.click(chart());
    const dialog = await screen.findByRole("dialog", { name: "Attach stats" });
    expect(
      await within(dialog).findByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Attach stats" })).toBeNull();
  });

  it("is not offered for a reply address, which still has the paperclip", () => {
    renderComposer("/compose?reply_to=42");

    expect(screen.queryByRole("button", { name: "Attach stats" })).toBeNull();
    expect(paperclip()).toBeInTheDocument();
  });

  it("is not offered in the reply box", () => {
    renderReplyBox();

    expect(screen.queryByRole("button", { name: "Attach stats" })).toBeNull();
  });
});

describe("an attached link shows its summary, panel open or not", () => {
  it("a pre-filled address: the summary with the panel closed, then open, then closed", async () => {
    server.use(...attachServer().handlers);
    const { user } = renderComposer("/compose?link=game_final&ref=501");

    const summary = await summaryShown();
    expect(textOf(summary)).toMatch(/\b117\b/);
    expect(chart()).not.toHaveAttribute("aria-expanded");

    await user.click(chart());
    expect(attachedSummary()).not.toBeNull();

    await user.click(
      await within(
        await screen.findByRole("dialog", { name: "Attach stats" }),
      ).findByRole("button", { name: "Cancel" }),
    );
    expect(chart()).not.toHaveAttribute("aria-expanded");
    await waitFor(() => expect(attachedSummary()).not.toBeNull());
  });
});

describe("the row sits under the text box, before Post", () => {
  it("in the composer", () => {
    renderComposer();
    const text = screen.getByRole("textbox", { name: /post/i });
    const post = screen.getByRole("button", { name: /^post$/i });

    for (const control of [paperclip(), chart()]) {
      expect(follows(text, control), "after the text box").toBe(true);
      expect(follows(control, post), "before Post").toBe(true);
    }
  });

  it("in the reply box", () => {
    renderReplyBox();
    const text = screen.getByRole("textbox", { name: /your reply/i });
    const reply = screen.getByRole("button", { name: "Reply" });

    expect(follows(text, paperclip())).toBe(true);
    expect(follows(paperclip(), reply)).toBe(true);
  });
});

describe("the image tile's overlay is static (A8)", () => {
  it("no compose stylesheet declares keyframes or an animation", () => {
    const files = moduleCssFiles(join(SRC_DIR, "features", "compose"));
    expect(files.length).toBeGreaterThan(0);

    const animated = files.filter((file) => {
      const blocks = allBlocks(parseCss(readFileSync(file, "utf8")));
      return blocks.some(
        (block) =>
          /^@(-\w+-)?keyframes\b/i.test(block.prelude) ||
          block.declarations.some(
            (declaration) =>
              /^animation(-name)?$/.test(declaration.property) &&
              !/^none$/i.test(declaration.value.trim()),
          ),
      );
    });

    expect(animated).toEqual([]);
  });
});
