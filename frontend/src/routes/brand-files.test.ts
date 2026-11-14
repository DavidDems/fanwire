/**
 * The header's brand files are in the bundle.
 *
 * `src/assets/brand/` holds `wordmark-light.png` and `wordmark-dark.png`, the
 * cursive `fanwire` wordmark on a transparent background (Jet Black and Pale
 * Sky), copies of `brand/out/`. The wire-`f` symbol is no longer in the header,
 * so its copy and the old typeset SVG wordmarks are gone.
 *
 * Nothing here compares with `brand/out/`: the test container copies
 * `frontend/` only, so a comparison would pass locally and fail in CI
 * (`verification.md` §2a). Each file is asserted to exist and to be a PNG.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../test/css";

const BRAND_DIR = join(SRC_DIR, "assets", "brand");
const BRAND_FILES = ["wordmark-light.png", "wordmark-dark.png"];
const RETIRED = ["symbol.svg", "wordmark-light.svg", "wordmark-dark.svg"];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("src/assets/brand", () => {
  it.each(BRAND_FILES)("%s exists", (name) => {
    expect(existsSync(join(BRAND_DIR, name)), `src/assets/brand/${name}`).toBe(
      true,
    );
  });

  it.each(BRAND_FILES)("%s is a PNG", (name) => {
    const file = join(BRAND_DIR, name);
    expect(existsSync(file), `src/assets/brand/${name} must exist`).toBe(true);

    expect([...readFileSync(file).subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it.each(RETIRED)("%s is gone", (name) => {
    expect(existsSync(join(BRAND_DIR, name)), `src/assets/brand/${name}`).toBe(
      false,
    );
  });
});
