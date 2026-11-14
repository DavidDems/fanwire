/**
 * UI-002 criterion 5: Badge variant live shows the word it is given plus an
 * aria-hidden dot; neutral and outline have no dot. Colour is never the only
 * signal — the word is (accessibility.md A7).
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./Badge";

describe("Badge", () => {
  it("variant live renders the visible word plus one aria-hidden dot", () => {
    const { container } = render(<Badge variant="live">Live</Badge>);

    expect(container.textContent?.trim()).toBe("Live");

    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden).toHaveLength(1);
    // The dot carries no text, so the visible word is the whole name.
    expect(hidden[0].textContent).toBe("");
  });

  it("variant live renders whatever word it is given", () => {
    const { container } = render(<Badge variant="live">On air</Badge>);

    expect(container.textContent?.trim()).toBe("On air");
  });

  it.each(["neutral", "outline"] as const)(
    "variant %s renders its word and no dot",
    (variant) => {
      const { container } = render(<Badge variant={variant}>TOR</Badge>);

      expect(container.textContent?.trim()).toBe("TOR");
      expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(
        0,
      );
    },
  );
});
