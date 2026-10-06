/**
 * UI-003 acceptance criterion 1: the header's brand files are in the bundle.
 *
 * `src/assets/brand/` holds `wordmark-light.svg`, `wordmark-dark.svg` and
 * `symbol.svg` — copies of `brand/out/wordmark-light.svg`, `wordmark-dark.svg`
 * and `favicon.svg` (the bolder small-size cut, because it reads at 28 px).
 *
 * Nothing here compares with `brand/out/`: the test container copies
 * `frontend/` only, so a comparison would pass locally and fail in CI
 * (`verification.md` §2a). Each file is asserted to exist and to be an SVG
 * document — it parses as XML and its root element is `<svg>`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../test/css";

const BRAND_DIR = join(SRC_DIR, "assets", "brand");
const BRAND_FILES = ["wordmark-light.svg", "wordmark-dark.svg", "symbol.svg"];
const SVG_NS = "http://www.w3.org/2000/svg";

describe("src/assets/brand", () => {
  it.each(BRAND_FILES)("%s exists", (name) => {
    expect(existsSync(join(BRAND_DIR, name)), `src/assets/brand/${name}`).toBe(
      true,
    );
  });

  it.each(BRAND_FILES)("%s is an <svg> document", (name) => {
    const file = join(BRAND_DIR, name);
    expect(existsSync(file), `src/assets/brand/${name} must exist`).toBe(true);

    const text = readFileSync(file, "utf8");
    // Text before the root may only be an XML declaration, comments or a doctype.
    expect(text).toMatch(
      /^﻿?\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/,
    );

    const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
    expect(parsed.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(parsed.documentElement.localName).toBe("svg");
    expect(parsed.documentElement.namespaceURI).toBe(SVG_NS);
  });
});
