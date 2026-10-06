/**
 * UI-002 criterion 1: Button is a native <button> that passes every prop
 * through, and its variant/size map to the classes its CSS module exports.
 * `buttonClass(variant, size)` gives a Link exactly the same classes.
 *
 * Classes are asserted only through the module's own export — CSS Module names
 * are hashed (`wiki/CodeContext/FrontendUI/verification.md` §1, §2c).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button, buttonClass } from "./Button";
import styles from "./Button.module.css";

const VARIANTS = ["primary", "secondary", "ghost"] as const;
const SIZES = ["md", "sm"] as const;

describe("Button", () => {
  it("renders a native <button> with its children as the accessible name", () => {
    render(
      <Button variant="primary" size="md">
        Post
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Post" });
    expect(button.tagName).toBe("BUTTON");
  });

  it("passes type, disabled, aria-* and data-* attributes through", () => {
    render(
      <Button
        variant="secondary"
        size="sm"
        type="submit"
        disabled
        aria-expanded="true"
        aria-describedby="hint"
        data-active=""
        id="unfollow"
        name="unfollow"
      >
        Unfollow
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Unfollow" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-describedby", "hint");
    expect(button).toHaveAttribute("data-active", "");
    expect(button).toHaveAttribute("id", "unfollow");
    expect(button).toHaveAttribute("name", "unfollow");
  });

  it("passes onClick through", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="ghost" size="sm" onClick={onClick}>
        Clear
      </Button>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick while disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" size="md" onClick={onClick} disabled>
        Save
      </Button>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("exports a class for every variant and size", () => {
    for (const name of [...VARIANTS, ...SIZES]) {
      expect(styles[name], `Button.module.css must define .${name}`).toEqual(
        expect.any(String),
      );
      expect(styles[name]).not.toBe("");
    }
  });

  describe.each(VARIANTS)("variant %s", (variant) => {
    it.each(SIZES)("with size %s gets the variant and size classes", (size) => {
      render(
        <Button variant={variant} size={size}>
          Go
        </Button>,
      );

      const button = screen.getByRole("button", { name: "Go" });
      expect(button).toHaveClass(styles[variant]);
      expect(button).toHaveClass(styles[size]);

      for (const other of VARIANTS.filter((v) => v !== variant)) {
        expect(button).not.toHaveClass(styles[other]);
      }
      for (const other of SIZES.filter((s) => s !== size)) {
        expect(button).not.toHaveClass(styles[other]);
      }
    });

    it.each(SIZES)(
      "buttonClass(%s) is exactly the class string the Button gets",
      (size) => {
        render(
          <Button variant={variant} size={size}>
            Go
          </Button>,
        );

        const button = screen.getByRole("button", { name: "Go" });
        const forLink = buttonClass(variant, size);

        expect(typeof forLink).toBe("string");
        expect(forLink.split(/\s+/).filter(Boolean).sort()).toEqual(
          button.className.split(/\s+/).filter(Boolean).sort(),
        );
      },
    );
  });

  it("buttonClass carries the variant and size classes for a Link", () => {
    const classes = buttonClass("primary", "md").split(/\s+/);

    expect(classes).toContain(styles.primary);
    expect(classes).toContain(styles.md);
    expect(classes).not.toContain(styles.secondary);
    expect(classes).not.toContain(styles.sm);
  });
});
