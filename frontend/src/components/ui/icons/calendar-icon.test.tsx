/**
 * FRONTEND-044 adds lucide `calendar` for the Schedule nav item:
 * `CalendarIcon`, copied like the others from the same Lucide commit and
 * under the same licence (`icons/LICENSE`), in the same frame (one
 * `<svg aria-hidden="true">` drawn with currentColor, 20 px by default,
 * `size` and `className` props). Its four shapes are pinned below as Lucide
 * draws them (`icons/calendar.svg`), and the index's header names it.
 *
 * A file of its own, so `icons.test.tsx`'s pins stay as they are.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CalendarIcon } from "./index";

const SHAPES = "path, circle, line, rect, polyline, polygon, ellipse";

describe("calendar (FRONTEND-044)", () => {
  it('renders one <svg aria-hidden="true">', () => {
    const { container } = render(<CalendarIcon />);

    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    expect(container.firstElementChild).toBe(svgs[0]);
    expect(svgs[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("is drawn with currentColor and no other colour", () => {
    const { container } = render(<CalendarIcon />);

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

  it("is 20 px by default, on Lucide's 24 grid", () => {
    const { container } = render(<CalendarIcon />);

    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
  });

  it("takes size and className", () => {
    const { container } = render(<CalendarIcon size={24} className="lead" />);

    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
    expect(svg).toHaveClass("lead");
  });

  it("draws Lucide's four shapes, unchanged: two rings, the body, the header line", () => {
    const { container } = render(<CalendarIcon />);

    const shapes = [...container.querySelectorAll("svg > *")].map((shape) => {
      const attributes = [...shape.attributes]
        .map((attribute) => `${attribute.name}=${attribute.value}`)
        .sort();
      return `${shape.localName}[${attributes.join(" ")}]`;
    });
    expect(shapes).toEqual([
      "path[d=M8 2v4]",
      "path[d=M16 2v4]",
      "rect[height=18 rx=2 width=18 x=3 y=4]",
      "path[d=M3 10h18]",
    ]);
  });

  it("is documented in the index's header with the others", () => {
    const index = readFileSync(join(iconsDir(), "index.tsx"), "utf8");

    expect(index).toMatch(/lucide: calendar(?![\w-])/);
  });
});

function iconsDir(): string {
  for (const candidate of [
    join(process.cwd(), "src", "components", "ui", "icons"),
    join(process.cwd(), "frontend", "src", "components", "ui", "icons"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot locate the icons folder from ${process.cwd()}`);
}
