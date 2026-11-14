/**
 * FRONTEND-004 acceptance criterion 1 — the Builder; since FRONTEND-013
 * (criterion 10) it also carries the draft's one `data_link`.
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

import type { DataLink } from "../../test/attach";
import { emptyDraft, type Draft } from "./draft";
import { PostBuilder } from "./PostBuilder";

describe("the empty draft", () => {
  it("is text-less, media-less, link-less and out of any reply or repost context", () => {
    expect(emptyDraft()).toEqual({
      text: "",
      mediaIds: [],
      replyToPostId: null,
      repostOfPostId: null,
      dataLink: null,
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
      dataLink: null,
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
      dataLink: null,
    };

    expect(PostBuilder.from(draft).draft()).toEqual(draft);
  });

  it("does not keep a reference to the draft it was started from", () => {
    const draft: Draft = {
      text: "already typed",
      mediaIds: [5],
      replyToPostId: null,
      repostOfPostId: null,
      dataLink: null,
    };
    const builder = PostBuilder.from(draft);

    draft.mediaIds.push(6);
    draft.text = "changed underneath";

    expect(builder.draft()).toEqual({
      text: "already typed",
      mediaIds: [5],
      replyToPostId: null,
      repostOfPostId: null,
      dataLink: null,
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
    const request = new PostBuilder()
      .withText("look at this")
      .repostOf(9)
      .build();

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
    expect(new PostBuilder().withText("  Raptors win  ").build().text).toBe(
      "Raptors win",
    );
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

// ------------------------------------------------- FRONTEND-013 criterion 10

// Fixed values for comparing against, and fresh copies for handing in: a
// shared constant handed to a builder that fails to copy it would be changed
// by one test and break the next.
const GAME: DataLink = Object.freeze({ type: "game_final", ref_id: 501 });
const LINE: DataLink = Object.freeze({ type: "player_game", ref_id: 80001 });
const CAREER: DataLink = Object.freeze({
  type: "player_career",
  ref_id: 2544,
  scope: "playoffs",
});

function fresh(link: DataLink): DataLink {
  return { ...link };
}

describe("PostBuilder carries the draft's one data link", () => {
  it("accumulates a link with withDataLink, replacing any before it", () => {
    const builder = new PostBuilder().withText("x");

    expect(builder.withDataLink(fresh(GAME))).toBe(builder);
    builder.withDataLink(fresh(CAREER));

    expect(builder.draft().dataLink).toEqual(CAREER);
    expect(builder.withDataLink(null).draft().dataLink).toBeNull();
  });

  it("does not share the link with the draft it was started from", () => {
    const draft: Draft = {
      ...emptyDraft(),
      text: "x",
      dataLink: { type: "game_final", ref_id: 501 },
    };
    const builder = PostBuilder.from(draft);

    (draft.dataLink as DataLink).ref_id = 999;

    expect(builder.draft().dataLink).toEqual(GAME);
  });

  it("hands out a copy of the link, not its own", () => {
    const builder = PostBuilder.from({
      ...emptyDraft(),
      text: "x",
      dataLink: fresh(GAME),
    });

    (builder.draft().dataLink as DataLink).ref_id = 999;

    expect(builder.draft().dataLink).toEqual(GAME);
  });
});

describe("build() sends data_link exactly as attached", () => {
  it.each([
    ["a game result", GAME, ["ref_id", "type"]],
    ["a player's game", LINE, ["ref_id", "type"]],
    ["a career", CAREER, ["ref_id", "scope", "type"]],
  ] as const)("sends %s with only its own keys", (_name, link, keys) => {
    const request = PostBuilder.from({
      ...emptyDraft(),
      text: "Look",
      dataLink: fresh(link),
    }).build();

    expect(request.data_link).toEqual(link);
    expect(Object.keys(request.data_link ?? {}).sort()).toEqual([...keys]);
  });

  it("sends it alongside text and media", () => {
    const request = PostBuilder.from({
      ...emptyDraft(),
      text: " Raptors in 6 ",
      mediaIds: [11],
      dataLink: fresh(GAME),
    }).build();

    expect(request).toEqual({
      text: "Raptors in 6",
      media_ids: [11],
      is_reply: false,
      parent_post_id: null,
      is_repost: false,
      original_post_id: null,
      data_link: GAME,
    });
  });

  it("sends no data_link key at all without a link", () => {
    // `ThreadModal.test.tsx` pins a reply body with `toEqual`; `null` would
    // be a different body.
    const request = new PostBuilder().withText("Raptors win").build();

    expect(Object.keys(request)).not.toContain("data_link");
  });

  it("is not the builder's own object", () => {
    const builder = PostBuilder.from({
      ...emptyDraft(),
      text: "x",
      dataLink: fresh(GAME),
    });

    const request = builder.build();
    (request.data_link as DataLink).ref_id = 999;

    expect(builder.build().data_link).toEqual(GAME);
  });
});

describe("a link is not content on its own", () => {
  it("cannot be posted with no text and no image", () => {
    const builder = PostBuilder.from({
      ...emptyDraft(),
      dataLink: fresh(GAME),
    });

    expect(builder.canBuild()).toBe(false);
    expect(() => builder.build()).toThrow();
  });

  it("can be posted with only an image beside it", () => {
    expect(
      PostBuilder.from({
        ...emptyDraft(),
        mediaIds: [5],
        dataLink: fresh(GAME),
      }).canBuild(),
    ).toBe(true);
  });

  it("on a repost, needs text even with an image", () => {
    const repost = {
      ...emptyDraft(),
      repostOfPostId: 9,
      mediaIds: [5],
      dataLink: fresh(GAME),
    };

    expect(PostBuilder.from(repost).canBuild()).toBe(false);
    expect(PostBuilder.from({ ...repost, text: "   " }).canBuild()).toBe(false);
    expect(PostBuilder.from({ ...repost, text: "This one" }).canBuild()).toBe(
      true,
    );
  });

  it("leaves a repost with no link as it was: an image is enough", () => {
    expect(
      PostBuilder.from({
        ...emptyDraft(),
        repostOfPostId: 9,
        mediaIds: [5],
      }).canBuild(),
    ).toBe(true);
  });
});
