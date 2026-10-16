/**
 * UI-002 criterion 9: the thirteen Lucide icons of `components.md` §3, copied
 * as inline SVG components (no `lucide-react` dependency). Each renders an
 * <svg aria-hidden="true"> drawn with currentColor, and Lucide's ISC licence
 * sits beside them in `icons/LICENSE`.
 *
 * Export names are the Lucide name in PascalCase plus `Icon`, all from
 * `src/components/ui/icons/index.ts`.
 *
 * FRONTEND-009 adds a fourteenth, lucide `chart-column`, for the Stats nav
 * item: `ChartColumnIcon`, in the same shape as the others and under the same
 * licence. Its four paths are pinned below as Lucide draws them.
 *
 * UI-009 adds the two pressed variants for the post card, so a pressed like or
 * repost is told apart by shape and not by colour alone (`accessibility.md`):
 * `HeartFilledIcon`, Lucide's heart path filled with currentColor, and
 * `Repeat2FilledIcon`, Lucide's repeat-2 paths drawn heavier than the default
 * stroke of 2. Both keep the shared frame (aria-hidden, currentColor only).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import {
  BellIcon,
  ChartColumnIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  HeartFilledIcon,
  HeartIcon,
  HouseIcon,
  ImageIcon,
  MessageCircleIcon,
  Repeat2FilledIcon,
  Repeat2Icon,
  SearchIcon,
  SquarePenIcon,
  UserIcon,
  XIcon,
} from "./index";

/** Lucide name → component: the thirteen of components.md §3, plus chart-column (FRONTEND-009). */
const ICONS: [string, ComponentType][] = [
  ["house", HouseIcon],
  ["search", SearchIcon],
  ["square-pen", SquarePenIcon],
  ["bell", BellIcon],
  ["user", UserIcon],
  ["heart", HeartIcon],
  ["message-circle", MessageCircleIcon],
  ["repeat-2", Repeat2Icon],
  ["chevron-down", ChevronDownIcon],
  ["x", XIcon],
  ["image", ImageIcon],
  ["circle-alert", CircleAlertIcon],
  ["circle-check", CircleCheckIcon],
  ["chart-column", ChartColumnIcon],
  ["heart (filled, UI-009)", HeartFilledIcon],
  ["repeat-2 (heavier, UI-009)", Repeat2FilledIcon],
];

const SHAPES = "path, circle, line, rect, polyline, polygon, ellipse";

describe.each(ICONS)("icon %s", (_name, Icon) => {
  it('renders one <svg aria-hidden="true">', () => {
    const { container } = render(<Icon />);

    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    expect(container.firstElementChild).toBe(svgs[0]);
    expect(svgs[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("is drawn with currentColor and no other colour", () => {
    const { container } = render(<Icon />);

    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg.querySelectorAll(SHAPES).length).toBeGreaterThan(0);

    for (const element of [svg, ...svg.querySelectorAll("*")]) {
      for (const attribute of ["stroke", "fill", "color"]) {
        const value = element.getAttribute(attribute);
        if (value !== null) {
          expect(
            ["currentColor", "none"],
            `${element.tagName} ${attribute}="${value}"`,
          ).toContain(value);
        }
      }
    }
  });
});

describe("chart-column (FRONTEND-009)", () => {
  it("draws Lucide's four paths: the axes, then three bars", () => {
    const { container } = render(<ChartColumnIcon />);

    const paths = [...container.querySelectorAll("svg > *")].map(
      (shape) => `${shape.localName} ${shape.getAttribute("d") ?? ""}`,
    );
    expect(paths).toEqual([
      "path M3 3v16a2 2 0 0 0 2 2h16",
      "path M18 17V9",
      "path M13 17V5",
      "path M8 17v-3",
    ]);
  });
});

/** Each child shape as `<name> <d>`, the way the chart-column test reads them. */
function shapesOf(Component: ComponentType): string[] {
  const { container } = render(<Component />);
  return [...container.querySelectorAll("svg > *, svg > g > *")]
    .filter((shape) => shape.localName !== "g")
    .map((shape) => `${shape.localName} ${shape.getAttribute("d") ?? ""}`);
}

/** Every stroke-width the icon sets, on the svg and on any shape or group in it. */
function strokeWidthsOf(Component: ComponentType): number[] {
  const { container } = render(<Component />);
  const svg = container.querySelector("svg") as SVGSVGElement;
  return [svg, ...svg.querySelectorAll("*")]
    .map((element) => element.getAttribute("stroke-width"))
    .filter((value): value is string => value !== null)
    .map(Number);
}

describe("heart, filled (UI-009)", () => {
  it("draws Lucide's heart path, unchanged", () => {
    expect(shapesOf(HeartFilledIcon)).toEqual(shapesOf(HeartIcon));
  });

  it("fills the heart with currentColor", () => {
    const { container } = render(<HeartFilledIcon />);

    expect(container.querySelector('[fill="currentColor"]')).not.toBeNull();
  });

  it("is distinguishable from the outline heart, which fills nothing", () => {
    const { container } = render(<HeartIcon />);

    expect(container.querySelector('[fill="currentColor"]')).toBeNull();
  });
});

describe("repeat-2, heavier (UI-009)", () => {
  it("draws Lucide's repeat-2 paths, unchanged", () => {
    expect(shapesOf(Repeat2FilledIcon)).toEqual(shapesOf(Repeat2Icon));
  });

  it("draws with a heavier stroke than the outline's 2", () => {
    expect(Math.max(...strokeWidthsOf(Repeat2Icon))).toBe(2);
    expect(
      Math.max(...strokeWidthsOf(Repeat2FilledIcon)),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("icons/LICENSE", () => {
  function findSrcDir(): string {
    for (const candidate of [
      join(process.cwd(), "src"),
      join(process.cwd(), "frontend", "src"),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`cannot locate frontend/src from ${process.cwd()}`);
  }

  const LICENSE = join(findSrcDir(), "components", "ui", "icons", "LICENSE");

  it("exists beside the copied icons", () => {
    expect(existsSync(LICENSE), `${LICENSE} must carry Lucide's licence`).toBe(
      true,
    );
  });

  it("is Lucide's ISC licence", () => {
    const text = readFileSync(LICENSE, "utf8").replace(/\s+/g, " ");

    expect(text).toContain("ISC License");
    expect(text).toContain("Copyright (c)");
    // "Lucide Contributors" before Lucide's 2026-03-20 licence update, "Lucide Icons and Contributors" since.
    expect(text).toMatch(/Lucide (Icons and )?Contributors/);
    expect(text).toContain(
      "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.",
    );
    expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });
});
