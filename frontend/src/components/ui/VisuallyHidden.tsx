import type { ReactNode } from "react";

/** Text for screen readers only, via the global `.visually-hidden` class in `base.css`. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="visually-hidden">{children}</span>;
}
