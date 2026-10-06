/**
 * UI-002 criterion 9: the thirteen Lucide icons of `components.md` §3, copied
 * as inline SVG components (no `lucide-react` dependency). Each renders an
 * <svg aria-hidden="true"> drawn with currentColor, and Lucide's ISC licence
 * sits beside them in `icons/LICENSE`.
 *
 * Export names are the Lucide name in PascalCase plus `Icon`, all from
 * `src/components/ui/icons/index.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import {
  BellIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  HeartIcon,
  HouseIcon,
  ImageIcon,
  MessageCircleIcon,
  Repeat2Icon,
  SearchIcon,
  SquarePenIcon,
  UserIcon,
  XIcon,
} from "./index";

/** Lucide name → component, exactly the thirteen of components.md §3. */
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
