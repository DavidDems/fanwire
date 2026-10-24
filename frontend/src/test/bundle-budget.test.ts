// @vitest-environment node
/**
 * UI-010 Baseline (c): the bundle budget, pinned against a real production
 * build.
 *
 * Runs Vite's own `build()` with the project's `vite.config.ts`, writes
 * nothing (`write: false`), and gzips every output with `zlib.gzipSync` at the
 * default level, which is what Vite's size report uses. 1 kB = 1000 bytes, as
 * Vite reports it.
 *
 * - The entry JS chunk: at most 149.6 kB gzip and 471.0 kB raw (before, on
 *   origin/main 8bda2e1: 148.61 / 468.08 as the skeptic measured).
 * - The entry CSS (the stylesheet the entry chunk imports): at most 6.25 kB
 *   gzip (before: 5.01).
 * - Every other JS chunk (the lazy routes and the shared chunks they split
 *   out): within 0.1 kB gzip of its before size, measured on the unchanged
 *   source and hard-coded below. This unit's files are all reached from the
 *   entry, so no lazy chunk has a reason to move, and none should appear.
 * - No output file is 500,000 bytes raw or larger.
 *
 * It is a ceiling, green before the change: it exists so the restyle and the
 * three new primitives stay "a few kilobytes at most".
 */
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { build, type Rollup } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

import { SRC_DIR } from "./css";

const KB = 1000;

const ENTRY_JS_GZIP_MAX = 149.6 * KB;
const ENTRY_JS_RAW_MAX = 471.0 * KB;
const ENTRY_CSS_GZIP_MAX = 6.25 * KB;
const LAZY_TOLERANCE = 0.1 * KB;
const FILE_RAW_LIMIT = 500_000;

/**
 * Non-entry JS chunks, by chunk name (no hash) → gzip bytes, measured on the
 * unchanged source (UI-010's worktree at 8bda2e1, before any change).
 */
const LAZY_CHUNKS_BEFORE: Record<string, number> = {
  ComposePage: 5178,
  NotificationsPage: 1667,
  ProfilePage: 2785,
  GamePage: 3386,
  PlayerPage: 3041,
  VisuallyHidden: 141,
  StatsPage: 382,
  SeasonsTab: 3789,
  format: 430,
  PlayersTab: 1133,
  links: 740,
  "Stats.module": 359,
  SignInPage: 990,
  SignUpPage: 878,
  ConfirmPage: 1056,
  ForgotPasswordPage: 1085,
  errors: 240,
  ProfileSetupPage: 1414,
  "AuthPage.module": 158,
};

interface Built {
  fileName: string;
  raw: number;
  gzip: number;
}

let output: (Rollup.OutputChunk | Rollup.OutputAsset)[] = [];

function bytesOf(file: Rollup.OutputChunk | Rollup.OutputAsset): Buffer {
  const content = file.type === "chunk" ? file.code : file.source;
  return typeof content === "string"
    ? Buffer.from(content, "utf8")
    : Buffer.from(content);
}

function measure(file: Rollup.OutputChunk | Rollup.OutputAsset): Built {
  const bytes = bytesOf(file);
  return {
    fileName: file.fileName,
    raw: bytes.length,
    gzip: gzipSync(bytes).length,
  };
}

function chunks(): Rollup.OutputChunk[] {
  return output.filter(
    (file): file is Rollup.OutputChunk => file.type === "chunk",
  );
}

function entryChunk(): Rollup.OutputChunk {
  const entries = chunks().filter((chunk) => chunk.isEntry);
  expect(
    entries.map((chunk) => chunk.fileName),
    "exactly one entry chunk",
  ).toHaveLength(1);
  return entries[0];
}

beforeAll(async () => {
  const frontend = resolve(SRC_DIR, "..");
  // Vitest runs with NODE_ENV=test; a build under it would bundle React's
  // development copy, which is not what ships.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const result = await build({
      root: frontend,
      configFile: resolve(frontend, "vite.config.ts"),
      mode: "production",
      logLevel: "silent",
      build: { write: false },
    });
    const results = Array.isArray(result) ? result : [result];
    output = results.flatMap((one) =>
      "output" in one ? (one.output as typeof output) : [],
    );
  } finally {
    process.env.NODE_ENV = previous;
  }
}, 180_000);

describe("the production bundle (UI-010 Baseline c)", () => {
  it("built something to measure (not vacuously green)", () => {
    expect(chunks().length).toBeGreaterThan(1);
  });

  it("keeps the entry JS chunk within 149.6 kB gzip and 471.0 kB raw", () => {
    const entry = measure(entryChunk());

    expect(entry.gzip, `${entry.fileName} gzip bytes`).toBeLessThanOrEqual(
      ENTRY_JS_GZIP_MAX,
    );
    expect(entry.raw, `${entry.fileName} raw bytes`).toBeLessThanOrEqual(
      ENTRY_JS_RAW_MAX,
    );
  });

  it("keeps the entry CSS within 6.25 kB gzip", () => {
    const importedCss = [...(entryChunk().viteMetadata?.importedCss ?? [])];
    expect(
      importedCss,
      "the entry chunk imports exactly one stylesheet",
    ).toHaveLength(1);
    const asset = output.find((file) => file.fileName === importedCss[0]);
    expect(asset, `${importedCss[0]} is in the output`).toBeDefined();

    const css = measure(asset as Rollup.OutputAsset);
    expect(css.gzip, `${css.fileName} gzip bytes`).toBeLessThanOrEqual(
      ENTRY_CSS_GZIP_MAX,
    );
  });

  it("keeps every lazy chunk within 0.1 kB gzip of its before size", () => {
    const after = new Map(
      chunks()
        .filter((chunk) => !chunk.isEntry)
        .map((chunk) => [chunk.name, measure(chunk).gzip] as const),
    );

    const drifted = Object.entries(LAZY_CHUNKS_BEFORE)
      .map(([name, before]) => ({ name, before, after: after.get(name) }))
      .filter(
        ({ before, after }) =>
          after === undefined || Math.abs(after - before) > LAZY_TOLERANCE,
      );
    expect(drifted, "lazy chunks missing or moved by more than 100 B").toEqual(
      [],
    );

    const unexpected = [...after.keys()].filter(
      (name) => !(name in LAZY_CHUNKS_BEFORE),
    );
    expect(unexpected, "new non-entry chunks").toEqual([]);
  });

  it("has no output file of 500,000 bytes raw or larger", () => {
    const large = output
      .map(measure)
      .filter((file) => file.raw >= FILE_RAW_LIMIT)
      .map((file) => `${file.fileName}: ${file.raw}`);

    expect(large).toEqual([]);
  });
});
