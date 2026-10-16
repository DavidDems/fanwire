/**
 * FRONTEND-010 criterion 13, pinned statically: every `*.module.css` this unit
 * adds — under `src/features/thread/`, and the shared `Dialog`'s — is read from
 * disk, because jsdom applies no styles (`verification.md` §1, §2a).
 *
 * No hex, `rgb()`, `hsl()` or named colour, no px font size, and no
 * `outline: none` / `outline: 0` without a `:focus-visible` rule in the same
 * file. The scanner is the shared one in `src/test/module-css.ts`, pinned
 * against fixtures in its own test. `components/ui/ui-css.test.ts` sweeps
 * `Dialog.module.css` too, with its own copy of the scanner; it is named here
 * as well so this unit's whole CSS is checked in one place.
 *
 * Not vacuous: the modal's layout (the thread's stack of cards, the composer's
 * place in it) is the thread's own, so at least one module file must be there.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";
import { moduleCssFiles, moduleCssViolations } from "../../test/module-css";

const THREAD_DIR = join(SRC_DIR, "features", "thread");
const DIALOG_CSS = join(SRC_DIR, "components", "ui", "Dialog.module.css");

describe("every *.module.css this unit adds", () => {
  const files = [
    ...moduleCssFiles(THREAD_DIR),
    ...(existsSync(DIALOG_CSS) ? [DIALOG_CSS] : []),
  ];
  const names = files.map((file) =>
    relative(SRC_DIR, file).split(sep).join("/"),
  );

  it("has module CSS under features/thread to check (not vacuously green)", () => {
    expect(
      moduleCssFiles(THREAD_DIR).length,
      `no *.module.css under ${THREAD_DIR}`,
    ).toBeGreaterThan(0);
  });

  it("uses only var(--color-…), no px font sizes, and a visible focus", () => {
    const problems = files.flatMap((file, index) =>
      moduleCssViolations(readFileSync(file, "utf8")).map(
        (problem) => `${names[index]}: ${problem}`,
      ),
    );

    expect(problems).toEqual([]);
  });
});
