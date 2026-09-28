/**
 * FRONTEND-004 acceptance criterion 5 — the Prototype.
 *
 * `gof-patterns.md` assigns Prototype to `PostTemplate.clone()`: quick-post
 * templates ("final score reaction", "pre-game hype") are cloned from a stored
 * template and customised rather than built from scratch.
 *
 * The brief names the criterion that actually matters, so it is the one pinned
 * hardest: **a shallow copy that shares the media-id array looks correct until
 * the second template is used**. Every test below is some form of "edit what
 * `clone()` returned; the stored template is still what it was".
 */
import { describe, expect, it } from "vitest";

import { PostTemplate, QUICK_POST_TEMPLATES } from "./PostTemplate";

describe("PostTemplate.clone()", () => {
  it("produces a draft carrying the template's content", () => {
    const template = new PostTemplate("Final score reaction", {
      text: "What a finish — ",
    });

    expect(template.clone()).toEqual({
      text: "What a finish — ",
      mediaIds: [],
      replyToPostId: null,
      repostOfPostId: null,
    });
  });

  it("fills in everything the template does not set", () => {
    expect(new PostTemplate("Bare", {}).clone()).toEqual({
      text: "",
      mediaIds: [],
      replyToPostId: null,
      repostOfPostId: null,
    });
  });

  it("leaves the template unchanged when the cloned draft is edited", () => {
    const template = new PostTemplate("Pre-game hype", {
      text: "Tip-off soon: ",
    });

    const draft = template.clone();
    draft.text += "Raptors by 12";
    draft.replyToPostId = 77;

    expect(template.clone()).toEqual({
      text: "Tip-off soon: ",
      mediaIds: [],
      replyToPostId: null,
      repostOfPostId: null,
    });
  });

  it("does not share the media-id array with the template or with another clone", () => {
    // The specific defect the brief calls out: a shallow copy passes every test
    // above and fails here, on the *second* use of the template.
    const template = new PostTemplate("With an image", {
      text: "look",
      mediaIds: [5],
    });

    const first = template.clone();
    first.mediaIds.push(99);
    const second = template.clone();

    expect(second.mediaIds).toEqual([5]);
    expect(second.mediaIds).not.toBe(first.mediaIds);
    expect(template.clone().mediaIds).not.toBe(template.clone().mediaIds);
  });

  it("does not keep a reference to the object it was constructed from", () => {
    const source = { text: "seed", mediaIds: [5] };
    const template = new PostTemplate("Seeded", source);

    source.text = "changed underneath";
    source.mediaIds.push(6);

    expect(template.clone()).toEqual({
      text: "seed",
      mediaIds: [5],
      replyToPostId: null,
      repostOfPostId: null,
    });
  });

  it("names the template, so the composer has something to label a control with", () => {
    expect(new PostTemplate("Final score reaction", {}).name).toBe("Final score reaction");
  });
});

describe("the stored quick-post templates", () => {
  it("offers more than one, each with a distinct name", () => {
    const names = QUICK_POST_TEMPLATES.map((template: PostTemplate) => template.name);

    expect(names.length).toBeGreaterThan(1);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name: string) => name.trim().length > 0)).toBe(true);
  });

  it("gives each one something to start the draft with", () => {
    for (const template of QUICK_POST_TEMPLATES) {
      expect(
        template.clone().text.length,
        `${template.name} clones an empty draft`,
      ).toBeGreaterThan(0);
    }
  });

  it("survives a draft cloned from it being edited", () => {
    for (const template of QUICK_POST_TEMPLATES) {
      const before = template.clone();

      const draft = template.clone();
      draft.text = "mutated";
      draft.mediaIds.push(1);
      draft.replyToPostId = 3;

      expect(template.clone(), `${template.name} was changed by editing its clone`).toEqual(before);
    }
  });
});
