import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC_DIR, allBlocks, parseCss, selectors } from "../../test/css";
import { moduleCssViolations } from "../../test/module-css";

const FILE = join(SRC_DIR, "features", "compose", "StatsPicker.module.css");
function blocks() {
  expect(existsSync(FILE), "picker stylesheet exists").toBe(true);
  return allBlocks(parseCss(readFileSync(FILE, "utf8")));
}
describe("picker layout and keyboard styling", () => {
  it("anchors the dialog at the top so async content grows down", () => {
    expect(
      blocks().some(
        (block) =>
          selectors(block).some((selector) => /dialog/.test(selector)) &&
          block.declarations.some(
            (declaration) =>
              /margin-block|margin-top|inset-block-start|top/.test(
                declaration.property,
              ) && declaration.value !== "auto",
          ),
      ),
    ).toBe(true);
  });
  it("keeps the footer sticky on screen", () => {
    expect(
      blocks().some(
        (block) =>
          block.declarations.some(
            (declaration) =>
              declaration.property === "position" &&
              declaration.value === "sticky",
          ) &&
          block.declarations.some((declaration) =>
            /bottom|inset-block-end/.test(declaration.property),
          ),
      ),
    ).toBe(true);
  });
  it("provides a visible focus ring for native radio choices", () => {
    expect(
      blocks().some(
        (block) =>
          selectors(block).some((selector) =>
            /:focus-visible/.test(selector),
          ) &&
          block.declarations.some(
            (declaration) =>
              /outline|box-shadow/.test(declaration.property) &&
              !/^(none|0)$/.test(declaration.value),
          ),
      ),
    ).toBe(true);
  });
  it("uses project tokens and no raw colours or pixel font sizes", () => {
    blocks();
    expect(moduleCssViolations(readFileSync(FILE, "utf8"))).toEqual([]);
  });
});
