import type { HTMLAttributes } from "react";

import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** The element, and so its role, is the caller's choice: `PostNode` stays an `<article>`. */
  as?: "article" | "section" | "div";
}

export function Card({ as: Element = "div", className, ...rest }: CardProps) {
  return (
    <Element
      {...rest}
      className={className ? `${styles.card} ${className}` : styles.card}
    />
  );
}
