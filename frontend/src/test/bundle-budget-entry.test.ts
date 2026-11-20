/**
 * `entryClosure` (FRONTEND-046): what the bundle budget counts as the entry.
 *
 * Rolldown (vite 8) splits what Rollup (vite 7) built as one entry chunk into
 * the entry plus chunks it imports statically, which `index.html` preloads.
 * Those load with the entry, so they are the entry, not lazy outputs. A chunk
 * reached only through a dynamic import is lazy.
 */
import { describe, expect, it } from "vitest";

import { entryClosure } from "./bundle-budget";

interface Chunk {
  fileName: string;
  imports: string[];
  dynamicImports: string[];
}

function chunk(
  fileName: string,
  imports: string[] = [],
  dynamicImports: string[] = [],
): Chunk {
  return { fileName, imports, dynamicImports };
}

function names(chunks: Chunk[]): string[] {
  return chunks.map((one) => one.fileName).sort();
}

describe("entryClosure", () => {
  it("is the entry alone when it imports nothing (vite 7's build)", () => {
    const entry = chunk("index.js", [], ["lazy.js"]);
    const output = [entry, chunk("lazy.js")];

    expect(names(entryClosure(entry, output))).toEqual(["index.js"]);
  });

  it("follows static imports transitively, and not dynamic ones", () => {
    const entry = chunk("index.js", ["a.js"], ["lazy.js"]);
    const output = [
      entry,
      chunk("a.js", ["b.js"]),
      chunk("b.js"),
      chunk("lazy.js", ["b.js"]),
    ];

    expect(names(entryClosure(entry, output))).toEqual([
      "a.js",
      "b.js",
      "index.js",
    ]);
  });

  it("does not take a lazy chunk in through a dynamic import of a closure chunk", () => {
    const entry = chunk("index.js", ["a.js"]);
    const output = [entry, chunk("a.js", [], ["lazy.js"]), chunk("lazy.js")];

    expect(names(entryClosure(entry, output))).toEqual(["a.js", "index.js"]);
  });

  it("terminates on an import cycle, counting each chunk once", () => {
    const entry = chunk("index.js", ["a.js"]);
    const output = [
      entry,
      chunk("a.js", ["b.js"]),
      chunk("b.js", ["a.js", "index.js"]),
    ];

    const closure = entryClosure(entry, output);

    expect(names(closure)).toEqual(["a.js", "b.js", "index.js"]);
    expect(closure).toHaveLength(3);
  });

  it("fails on an import the output does not hold", () => {
    const entry = chunk("index.js", ["missing.js"]);

    expect(() => entryClosure(entry, [entry])).toThrow(/missing\.js/);
  });
});
