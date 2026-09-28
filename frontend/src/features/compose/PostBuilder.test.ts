/**
 * FRONTEND-004 acceptance criterion 1 — the Builder.
 *
 * `wiki/CodeContext/Standards/gof-patterns.md` assigns Builder to assembling a
 * `CreatePostRequest` across a multi-step compose flow, with the validation in
 * `build()`. The criterion has two halves and both are pinned here: the builder
 * *accumulates* across separate calls (not one all-at-once constructor), and
 * `build()` refuses a draft with neither text nor media rather than letting an
 * empty request reach `POST /posts`.
 *
 * The built value is asserted with `toEqual` against every field the generated
 * `CreatePostRequest` declares, not `toMatchObject`: "does not send an empty
 * request" is a statement about the whole body, so a body with a stray field or
 * a missing `media_ids` has to fail here.
 */
import { describe, expect, it } from "vitest";

import { emptyDraft, type Draft } from "./draft";
import { PostBuilder } from "./PostBuilder";

describe("the empty draft", () => {
  it("is text-less, media-less and out of any reply or repost context", () => {
    expect(emptyDraft()).toEqual({
      text: "",
      mediaIds: [],
      replyToPostId: null,
      repostOfPostId: null,
    });
  });

  it("is a fresh value every time, never a shared one", () => {
    // A module-level constant here is the defect that makes one composer's
    // attachment show up in the next one.
    expect(emptyDraft().mediaIds).not.toBe(emptyDraft().mediaIds);
  });
});

describe("PostBuilder accumulates a draft across separate calls", () => {
  it("keeps text, media ids and reply context added one call at a time", () => {
    const builder = new PostBuilder();

    builder.withText("Raptors win");
    builder.addMediaId(11);
    builder.replyTo(77);
    builder.addMediaId(12);

    expect(builder.draft()).toEqual({
      text: "Raptors win",
      mediaIds: [11, 12],
      replyToPostId: 77,
      repostOfPostId: null,
    });
  });

  it("replaces the text on each call rather than appending", () => {
    const builder = new PostBuilder();

    builder.withText("first");
    builder.withText("second");

    expect(builder.draft().text).toBe("second");
  });

  it("drops a media id that is detached again", () => {
    const builder = new PostBuilder().addMediaId(11).addMediaId(12);

    builder.removeMediaId(11);

    expect(builder.draft().mediaIds).toEqual([12]);
  });

  it("adds the same media id only once", () => {
    const builder = new PostBuilder().addMediaId(11).addMediaId(11);

    expect(builder.draft().mediaIds).toEqual([11]);
  });

  it("returns itself from every step, so the steps can be chained", () => {
    const builder = new PostBuilder();

    expect(builder.withText("x")).toBe(builder);
    expect(builder.addMediaId(1)).toBe(builder);
    expect(builder.removeMediaId(1)).toBe(builder);
    expect(builder.replyTo(2)).toBe(builder);
    expect(builder.repostOf(3)).toBe(builder);
  });

  it("hands out a copy of the draft, not its own state", () => {
    const builder = new PostBuilder().addMediaId(11);

    builder.draft().mediaIds.push(99);

    expect(builder.draft().mediaIds).toEqual([11]);
  });

  it("can be started from a draft that already exists", () => {
    const draft: Draft = {
      text: "already typed",
      mediaIds: [5],
      replyToPostId: 42,
      repostOfPostId: null,
    };

    expect(PostBuilder.from(draft).draft()).toEqual(draft);
  });

  it("does not keep a reference to the draft it was started from", () => {
    const draft: Draft = {
      text: "already typed",
      mediaIds: [5],
      replyToPostId: null,
      repostOfPostId: null,
    };
    const builder = PostBuilder.from(draft);

    draft.mediaIds.push(6);
    draft.text = "changed underneath";

    expect(builder.draft()).toEqual({
      text: "already typed",
      mediaIds: [5],
      replyToPostId: null,
      repostOfPostId: null,
    });
  });
});

describe("build() produces the request the API declares", () => {
  it("carries text, media and reply context into the wire shape", () => {
    const request = new PostBuilder()
      .withText("Raptors in 6")
      .addMediaId(11)
      .addMediaId(12)
      .replyTo(77)
      .build();

    expect(request).toEqual({
      text: "Raptors in 6",
      media_ids: [11, 12],
      is_reply: true,
      parent_post_id: 77,
      is_repost: false,
      original_post_id: null,
    });
  });

  it("carries repost context", () => {
    const request = new PostBuilder().withText("look at this").repostOf(9).build();

    expect(request).toEqual({
      text: "look at this",
      media_ids: [],
      is_reply: false,
      parent_post_id: null,
      is_repost: true,
      original_post_id: 9,
    });
  });

  it("sends no text at all for an image-only post", () => {
    // `Post.text` is nullable and a post may be media-only; an empty string is
    // not the same value and is not what the column means.
    const request = new PostBuilder().addMediaId(5).build();

    expect(request).toEqual({
      text: null,
      media_ids: [5],
      is_reply: false,
      parent_post_id: null,
      is_repost: false,
      original_post_id: null,
    });
  });

  it("trims the text it sends", () => {
    expect(new PostBuilder().withText("  Raptors win  ").build().text).toBe("Raptors win");
  });
});

describe("build() rejects a post with neither text nor media", () => {
  it("throws on a brand-new builder", () => {
    expect(() => new PostBuilder().build()).toThrow();
  });

  it("throws when the text is only whitespace and nothing is attached", () => {
    expect(() => new PostBuilder().withText("   \n  ").build()).toThrow();
  });

  it("throws when the last attachment is removed from a text-less draft", () => {
    const builder = new PostBuilder().addMediaId(11);

    builder.removeMediaId(11);

    expect(() => builder.build()).toThrow();
  });

  it("still throws when the only thing set is a reply target", () => {
    // Replying to a post is context, not content.
    expect(() => new PostBuilder().replyTo(77).build()).toThrow();
  });

  it("answers canBuild() the same way it decides, without throwing", () => {
    // The submit control needs the decision before the user presses it, and a
    // second copy of the rule in the page is how the two drift apart.
    expect(new PostBuilder().canBuild()).toBe(false);
    expect(new PostBuilder().withText("   ").canBuild()).toBe(false);
    expect(new PostBuilder().withText("Raptors win").canBuild()).toBe(true);
    expect(new PostBuilder().addMediaId(5).canBuild()).toBe(true);
  });
});
