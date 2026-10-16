/**
 * UI-009 criterion 2 — the count beside each control is text: an explicit
 * singular/plural noun (no `Intl.PluralRules` for one English noun) and the
 * number through `Intl.NumberFormat`, so thousands are separated in the viewer's
 * locale. The test environment's locale separates with a comma.
 */
import { describe, expect, it } from "vitest";

import { countText } from "./counts";

describe("countText", () => {
  it.each([
    [0, "0 likes"],
    [1, "1 like"],
    [2, "2 likes"],
    [1000, "1,000 likes"],
  ])("says %i as %s", (count, expected) => {
    expect(countText(count, "like", "likes")).toBe(expected);
  });

  it.each([
    [0, "0 replies"],
    [1, "1 reply"],
    [2, "2 replies"],
    [1000, "1,000 replies"],
  ])(
    "uses the plural it is given, not a suffix: %i as %s",
    (count, expected) => {
      expect(countText(count, "reply", "replies")).toBe(expected);
    },
  );

  it("formats the number the way Intl.NumberFormat does in this locale", () => {
    expect(countText(1234567, "repost", "reposts")).toBe(
      `${new Intl.NumberFormat().format(1234567)} reposts`,
    );
  });
});
