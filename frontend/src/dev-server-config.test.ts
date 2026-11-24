/**
 * `npm run dev` and the production build must both render.
 *
 * The Cognito SDK bundles the `buffer` polyfill, which reads Node's `global`
 * at module load. Browsers have no `global`, so an unrewritten reference
 * throws `ReferenceError: global is not defined` and `#root` stays empty.
 *
 * - **Dev server.** Vite 8 pre-bundles dependencies with Rolldown, which
 *   leaves `global` alone unless told otherwise. Measured with Playwright MCP
 *   on 2026-10-07; the Rolldown form was proven on a forced vite 8 pre-bundle
 *   (FRONTEND-049's spec). `esbuildOptions` is vite 7's spelling, which vite 8
 *   only maps over with a deprecation warning.
 * - **Production build.** Under vite 7 Rollup's CommonJS plugin rewrote
 *   `global`; Rolldown does not, and the vite 8 bump (#35) shipped a bundle
 *   that blanked the live site. A top-level `define` covers the build.
 *   `src/test/bundle-budget.test.ts` checks the built code itself.
 *
 * jsdom can't run the dev server, so this pins the config itself, and
 * `FrontendUI/verification-browser.md` §3a's Playwright check covers the browser.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function readViteConfig(): string {
  for (const dir of [process.cwd(), join(process.cwd(), "frontend")]) {
    const file = join(dir, "vite.config.ts");
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new Error(`cannot locate vite.config.ts from ${process.cwd()}`);
}

/** The text of the object literal that follows `key:`, braces balanced. */
function objectAfter(source: string, key: string): string | null {
  const start = source.search(new RegExp(`\\b${key}\\s*:\\s*\\{`));
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(open, i + 1);
  }
  return null;
}

const GLOBAL_TO_GLOBALTHIS = /\bglobal\s*:\s*["']globalThis["']/;

describe("vite.config.ts lets the browser load the Cognito SDK", () => {
  it("defines global as globalThis for the dev dependency pre-bundle", () => {
    const optimizeDeps = objectAfter(readViteConfig(), "optimizeDeps");
    expect(optimizeDeps, "an optimizeDeps block").not.toBeNull();
    const rolldownOptions = objectAfter(optimizeDeps ?? "", "rolldownOptions");
    expect(rolldownOptions, "optimizeDeps.rolldownOptions").not.toBeNull();
    const transform = objectAfter(rolldownOptions ?? "", "transform");
    expect(transform, "optimizeDeps.rolldownOptions.transform").not.toBeNull();
    const define = objectAfter(transform ?? "", "define");
    expect(
      define,
      "optimizeDeps.rolldownOptions.transform.define",
    ).not.toBeNull();
    expect(define).toMatch(GLOBAL_TO_GLOBALTHIS);
  });

  it("uses no esbuildOptions, vite 7's spelling", () => {
    expect(readViteConfig()).not.toMatch(/esbuildOptions/);
  });

  it("defines global as globalThis for the production build too", () => {
    const config = readViteConfig();
    const optimizeDeps = objectAfter(config, "optimizeDeps") ?? "";
    const define = objectAfter(config.replace(optimizeDeps, ""), "define");
    expect(define, "a top-level define block").not.toBeNull();
    expect(define).toMatch(GLOBAL_TO_GLOBALTHIS);
  });
});
