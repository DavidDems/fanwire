/**
 * D1 (wiki/CodeContext/FrontendUI/implementation-plan.md): the brand exports
 * are served from `public/` at fixed URLs, and `index.html` declares them.
 *
 * Nothing here compares with `brand/out/`: the test container copies
 * `frontend/` only (verification.md §2a), so a byte-for-byte comparison would
 * pass locally and fail in CI. Sizes and content are asserted instead.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** `frontend` locally, `/app` in the test container. */
function findFrontendDir(): string {
  for (const candidate of [process.cwd(), join(process.cwd(), "frontend")]) {
    if (
      existsSync(join(candidate, "index.html")) &&
      existsSync(join(candidate, "src"))
    ) {
      return candidate;
    }
  }
  throw new Error(`cannot locate frontend/ from ${process.cwd()}`);
}

const FRONTEND_DIR = findFrontendDir();
const PUBLIC_DIR = join(FRONTEND_DIR, "public");
const SITE = "https://fanwire.daviddems.com/";
const TAGLINE = "Sports talk, wired live.";

const PNG_SIZES: Record<string, [number, number]> = {
  "apple-touch-icon.png": [180, 180],
  "icon-192.png": [192, 192],
  "icon-512.png": [512, 512],
  "icon-maskable-512.png": [512, 512],
  "og-image.png": [1200, 630],
};
const BRAND_FILES = ["favicon.svg", "favicon.ico", ...Object.keys(PNG_SIZES)];

function readPublic(name: string): Buffer {
  return readFileSync(join(PUBLIC_DIR, name));
}

describe("brand files in public/", () => {
  it.each(BRAND_FILES)("%s exists", (name) => {
    expect(existsSync(join(PUBLIC_DIR, name))).toBe(true);
  });

  it.each(Object.entries(PNG_SIZES))(
    "%s is a PNG of %j",
    (name, [width, height]) => {
      const bytes = readPublic(name);
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
        width,
        height,
      ]);
    },
  );

  it("favicon.ico holds 16, 32 and 48 px images", () => {
    const bytes = readPublic("favicon.ico");
    expect(bytes.readUInt16LE(0)).toBe(0); // reserved
    expect(bytes.readUInt16LE(2)).toBe(1); // type: icon
    const count = bytes.readUInt16LE(4);
    const sizes: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + 16 * i;
      // A stored 0 means 256.
      const width = bytes[entry] || 256;
      const height = bytes[entry + 1] || 256;
      sizes.push(`${width}x${height}`);
    }
    expect(sizes).toEqual(expect.arrayContaining(["16x16", "32x32", "48x48"]));
  });

  it("favicon.svg is an SVG document", () => {
    expect(readPublic("favicon.svg").toString("utf8")).toMatch(/<svg[\s>]/);
  });
});

describe("manifest.webmanifest", () => {
  const manifestPath = join(PUBLIC_DIR, "manifest.webmanifest");

  function readManifest(): Record<string, unknown> {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
  }

  it("names the app fanwire, lowercase", () => {
    const manifest = readManifest();
    expect(manifest.name).toBe("fanwire");
    expect(manifest.short_name).toBe("fanwire");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#022b3a");
    expect(manifest.theme_color).toBe("#022b3a");
  });

  it("lists the three icons with their sizes and purpose", () => {
    expect(readManifest().icons).toEqual([
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });

  it("points only at icons that are in public/", () => {
    for (const icon of readManifest().icons as { src: string }[]) {
      expect(existsSync(join(PUBLIC_DIR, icon.src.replace(/^\//, "")))).toBe(
        true,
      );
    }
  });
});

describe("index.html head", () => {
  const doc = new DOMParser().parseFromString(
    readFileSync(join(FRONTEND_DIR, "index.html"), "utf8"),
    "text/html",
  );

  function content(selector: string): string | null {
    return doc.head.querySelector(selector)?.getAttribute("content") ?? null;
  }

  it("keeps the title exactly fanwire", () => {
    expect(doc.title).toBe("fanwire");
  });

  it("describes the site with the tagline", () => {
    expect(content('meta[name="description"]')).toBe(TAGLINE);
    expect(content('meta[property="og:description"]')).toBe(TAGLINE);
  });

  it("declares both colour schemes and a theme colour for each", () => {
    expect(content('meta[name="color-scheme"]')).toBe("light dark");
    const themes = [
      ...doc.head.querySelectorAll('meta[name="theme-color"]'),
    ].map((meta) => [meta.getAttribute("media"), meta.getAttribute("content")]);
    expect(themes).toEqual(
      expect.arrayContaining([
        ["(prefers-color-scheme: light)", "#ffffff"],
        ["(prefers-color-scheme: dark)", "#022b3a"],
      ]),
    );
    expect(themes).toHaveLength(2);
  });

  it("links the .ico and the SVG favicon", () => {
    const icons = [...doc.head.querySelectorAll('link[rel="icon"]')].map(
      (link) => ({
        href: link.getAttribute("href"),
        sizes: link.getAttribute("sizes"),
        type: link.getAttribute("type"),
      }),
    );
    expect(icons).toEqual(
      expect.arrayContaining([
        { href: "/favicon.ico", sizes: "32x32", type: null },
        { href: "/favicon.svg", sizes: null, type: "image/svg+xml" },
      ]),
    );
  });

  it("links the apple-touch-icon and the manifest", () => {
    expect(
      doc.head
        .querySelector('link[rel="apple-touch-icon"]')
        ?.getAttribute("href"),
    ).toBe("/apple-touch-icon.png");
    expect(
      doc.head.querySelector('link[rel="manifest"]')?.getAttribute("href"),
    ).toBe("/manifest.webmanifest");
  });

  it("declares the Open Graph card", () => {
    expect(content('meta[property="og:type"]')).toBe("website");
    expect(content('meta[property="og:site_name"]')).toBe("fanwire");
    expect(content('meta[property="og:title"]')).toBe("fanwire");
    expect(content('meta[property="og:url"]')).toBe(SITE);
    expect(content('meta[property="og:image"]')).toBe(`${SITE}og-image.png`);
    expect(content('meta[property="og:image:width"]')).toBe("1200");
    expect(content('meta[property="og:image:height"]')).toBe("630");
    expect(content('meta[property="og:image:alt"]')).toBe("fanwire");
    expect(content('meta[name="twitter:card"]')).toBe("summary_large_image");
  });

  it("uses only absolute https URLs in og:url and og:image", () => {
    const urls = [
      ...doc.head.querySelectorAll(
        'meta[property="og:url"], meta[property="og:image"]',
      ),
    ].map((meta) => meta.getAttribute("content") ?? "");
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url.startsWith(SITE)).toBe(true);
    }
  });
});
