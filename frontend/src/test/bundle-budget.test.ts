// @vitest-environment node
/**
 * The bundle budget, pinned against a real production build (UI-010
 * Baseline c, then each unit of Prompt 20 through `bundle-budgets/`).
 *
 * Runs Vite's own `build()` with the project's `vite.config.ts`, writes
 * nothing (`write: false`), and gzips every output with `zlib.gzipSync` at the
 * default level, which is what Vite's size report uses. 1 kB = 1000 bytes, as
 * Vite reports it.
 *
 * The numbers live in `bundle-budget.ts`: a measured base, plus one file per
 * later unit under `bundle-budgets/` that declares the chunks it changes, adds
 * or removes and how far it may grow the entry (R12, R13). Against the
 * combined budget:
 *
 * - The entry JS chunk stays within its gzip and raw ceilings, and never
 *   past 480 kB raw (R1).
 * - The entry CSS (the stylesheet the entry chunk imports) stays within its
 *   gzip ceiling.
 * - Every lazy output (JS chunk or stylesheet) no unit declares stays within
 *   0.1 kB gzip of its base size; every declared one stays within its
 *   ceiling; a removed one is gone; no output appears that nobody declared;
 *   and no two lazy outputs share a name, so none can hide behind another.
 * - No output file is 500,000 bytes raw or larger.
 */
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { build, type Rollup } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  FILE_RAW_LIMIT,
  TOLERANCE,
  combine,
  type UnitBudget,
} from "./bundle-budget";
import { SRC_DIR } from "./css";

const declared = import.meta.glob<{ default: UnitBudget }>(
  "./bundle-budgets/*.ts",
  { eager: true },
);

const budget = combine(
  Object.entries(declared).map(([path, module]) => {
    const unit = module.default;
    if (!path.endsWith(`/${unit.unit}.ts`))
      throw new Error(`${path} declares ${unit.unit}: name the file after it`);
    return unit;
  }),
);

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

/**
 * Every lazy output by budget name → gzip bytes: each non-entry JS chunk by
 * its chunk name, and each stylesheet but the entry's as `css:<asset name>`.
 * A list, not a map, so two outputs with one name can be seen.
 */
function lazyOutputs(): [string, number][] {
  const entryCss = new Set(entryChunk().viteMetadata?.importedCss ?? []);
  const js = chunks()
    .filter((chunk) => !chunk.isEntry)
    .map((chunk) => [chunk.name, measure(chunk).gzip] as [string, number]);
  const css = output
    .filter(
      (file): file is Rollup.OutputAsset =>
        file.type === "asset" &&
        file.fileName.endsWith(".css") &&
        !entryCss.has(file.fileName),
    )
    .map(
      (asset) =>
        [`css:${asset.names[0] ?? asset.fileName}`, measure(asset).gzip] as [
          string,
          number,
        ],
    );
  return [...js, ...css];
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

describe("the production bundle (UI-010 Baseline c, Prompt 20 R1, R12, R13)", () => {
  it("built something to measure (not vacuously green)", () => {
    expect(chunks().length).toBeGreaterThan(1);
  });

  it("keeps the entry JS chunk within its gzip and raw ceilings", () => {
    const entry = measure(entryChunk());

    expect(entry.gzip, `${entry.fileName} gzip bytes`).toBeLessThanOrEqual(
      budget.entryJsGzipMax,
    );
    expect(entry.raw, `${entry.fileName} raw bytes`).toBeLessThanOrEqual(
      budget.entryJsRawMax,
    );
  });

  it("keeps the entry CSS within its gzip ceiling", () => {
    const importedCss = [...(entryChunk().viteMetadata?.importedCss ?? [])];
    expect(
      importedCss,
      "the entry chunk imports exactly one stylesheet",
    ).toHaveLength(1);
    const asset = output.find((file) => file.fileName === importedCss[0]);
    expect(asset, `${importedCss[0]} is in the output`).toBeDefined();

    const css = measure(asset as Rollup.OutputAsset);
    expect(css.gzip, `${css.fileName} gzip bytes`).toBeLessThanOrEqual(
      budget.entryCssGzipMax,
    );
  });

  it("gives every lazy output its own name", () => {
    const names = lazyOutputs().map(([name]) => name);
    const repeated = names.filter(
      (name, index) => names.indexOf(name) !== index,
    );

    expect(names.length, "lazy outputs found").toBeGreaterThan(1);
    expect(repeated, "lazy outputs sharing a name").toEqual([]);
  });

  it("keeps every lazy output within its budget, and adds none undeclared", () => {
    const after = new Map(lazyOutputs());

    const drifted = Object.entries(budget.unchanged)
      .map(([name, before]) => ({ name, before, after: after.get(name) }))
      .filter(
        ({ before, after }) =>
          after === undefined || Math.abs(after - before) > TOLERANCE,
      );
    expect(
      drifted,
      "undeclared lazy outputs missing or moved by more than 100 B",
    ).toEqual([]);

    const over = Object.entries(budget.lazyMax)
      .filter(([name]) => !(name in budget.unchanged))
      .map(([name, max]) => ({ name, max, after: after.get(name) }))
      .filter(({ max, after }) => after === undefined || after > max);
    expect(over, "declared lazy outputs missing or over their ceiling").toEqual(
      [],
    );

    const unexpected = [...after.keys()].filter(
      (name) => !(name in budget.lazyMax),
    );
    expect(unexpected, "lazy outputs no budget declares").toEqual([]);
  });

  it("has no output file of 500,000 bytes raw or larger", () => {
    const large = output
      .map(measure)
      .filter((file) => file.raw >= FILE_RAW_LIMIT)
      .map((file) => `${file.fileName}: ${file.raw}`);

    expect(large).toEqual([]);
  });
});
