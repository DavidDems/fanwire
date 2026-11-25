import type { ButtonHTMLAttributes } from "react";

import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "sm";

/**
 * The classes a `Button` of this variant and size carries, for a `Link` that
 * should look like one (header "Sign in", the not-found link to the feed).
 */
export function buttonClass(variant: ButtonVariant, size: ButtonSize): string {
  return [styles.button, styles[variant], styles[size]].join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
  size: ButtonSize;
}

/**
 * A native `<button>`; every other prop is passed through. `data-active`
 * (Unfollow) is for CSS only, on a control whose label carries its state
 * (`components-shared.md` §2). A toggle whose name stays fixed (the post
 * card's Like and Repost, `features/feed/PostAction.tsx`, UI-009) passes
 * `aria-pressed` through instead.
 */
export function Button({ variant, size, className, ...rest }: ButtonProps) {
  const classes = buttonClass(variant, size);
  return (
    <button
      {...rest}
      className={className ? `${classes} ${className}` : classes}
    />
  );
}
