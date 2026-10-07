/**
 * `npm run dev` must render, not just `npm run build`.
 *
 * `amazon-cognito-identity-js` bundles the `buffer` polyfill, which reads
 * Node's `global` at module load. In a production build Rollup's CommonJS
 * handling copes with it. In the dev server Vite pre-bundles dependencies with
 * esbuild, which leaves `global` alone, so the browser throws
 * `ReferenceError: global is not defined` and `#root` stays empty. Measured
 * with Playwright MCP on 2026-10-07 against Vite 7.3.7.
 *
 * The fix is scoped to the dev pre-bundle (`optimizeDeps`), so it never
 * rewrites `global` in application code or in the production bundle.
 *
 * jsdom can't run the dev server, so this pins the config itself, and
 * `FrontendUI/verification.md` §3a's Playwright check covers the browser.
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

describe("vite.config.ts lets the dev server load the Cognito SDK", () => {
  it("defines global as globalThis for the dev dependency pre-bundle", () => {
    const optimizeDeps = objectAfter(readViteConfig(), "optimizeDeps");
    expect(optimizeDeps, "an optimizeDeps block").not.toBeNull();
    const define = objectAfter(optimizeDeps ?? "", "define");
    expect(define, "optimizeDeps.esbuildOptions.define").not.toBeNull();
    expect(define).toMatch(GLOBAL_TO_GLOBALTHIS);
  });

  it("does not rewrite global for application code or the production build", () => {
    const config = readViteConfig();
    const optimizeDeps = objectAfter(config, "optimizeDeps") ?? "";
    const outside = config.replace(optimizeDeps, "");
    expect(outside).not.toMatch(GLOBAL_TO_GLOBALTHIS);
  });
});
