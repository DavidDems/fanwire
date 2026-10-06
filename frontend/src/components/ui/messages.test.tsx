/**
 * UI-002 criterion 4: InlineAlert is a <p role="alert">, StatusLine a
 * <p role="status">, each whose text is its children. StatusLine takes variant
 * neutral or success. Leading icons (circle-alert, circle-check —
 * `components.md` §3) are aria-hidden, so they never add to the text or name.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InlineAlert } from "./InlineAlert";
import { StatusLine } from "./StatusLine";

describe("InlineAlert", () => {
  it('renders a <p role="alert"> whose text is the children', () => {
    render(<InlineAlert>Could not load the feed.</InlineAlert>);

    const alert = screen.getByRole("alert");
    expect(alert.tagName).toBe("P");
    expect(alert.textContent?.trim()).toBe("Could not load the feed.");
  });

  it("has a leading icon that is aria-hidden", () => {
    render(<InlineAlert>Could not load the feed.</InlineAlert>);

    const icons = screen.getByRole("alert").querySelectorAll("svg");
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });
});

describe("StatusLine", () => {
  it.each(["neutral", "success"] as const)(
    'variant %s renders a <p role="status"> whose text is the children',
    (variant) => {
      render(
        <StatusLine variant={variant}>Your profile has been saved.</StatusLine>,
      );

      const status = screen.getByRole("status");
      expect(status.tagName).toBe("P");
      expect(status.textContent?.trim()).toBe("Your profile has been saved.");
    },
  );

  it("variant success has a leading icon that is aria-hidden", () => {
    render(
      <StatusLine variant="success">Your profile has been saved.</StatusLine>,
    );

    const icons = screen.getByRole("status").querySelectorAll("svg");
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("variant neutral hides any icon it has from assistive technology", () => {
    render(<StatusLine variant="neutral">Loading…</StatusLine>);

    for (const icon of screen.getByRole("status").querySelectorAll("svg")) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });
});
