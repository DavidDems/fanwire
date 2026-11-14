import type { ReactNode } from "react";

/**
 * The frame every copied Lucide icon shares: Lucide's own root attributes
 * (24 × 24 viewBox, `currentColor` stroke, width 2, round caps and joins), plus
 * `aria-hidden` and `focusable="false"`. An icon never names anything — the
 * control beside it keeps its visible text (`accessibility.md` A14).
 */
export interface IconProps {
  /** Rendered width and height in CSS px. Lucide draws on a 24 grid. */
  size?: number;
  className?: string;
}

export function Icon({
  size = 20,
  className,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}
