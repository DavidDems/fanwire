/**
 * UI-002 criterion 3: Card renders the element its `as` prop names, with the
 * card class from its module. `PostNode` must stay an <article>, so the element
 * is the caller's choice (`components.md` §2).
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Card } from "./Card";
import styles from "./Card.module.css";

describe("Card", () => {
  it("exports a card class", () => {
    expect(styles.card).toEqual(expect.any(String));
    expect(styles.card).not.toBe("");
  });

  it.each(["article", "section", "div"] as const)(
    "renders as <%s> with the card class and its children",
    (as) => {
      const { container } = render(
        <Card as={as}>
          <p>Inside the card</p>
        </Card>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.tagName).toBe(as.toUpperCase());
      expect(root).toHaveClass(styles.card);
      expect(root).toHaveTextContent("Inside the card");
    },
  );
});
