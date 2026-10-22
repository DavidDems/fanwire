/**
 * FRONTEND-004 acceptance criterion 2 (behavioural half) and criterion 4
 * (the undo), rewritten for FRONTEND-013 criterion 10.
 *
 * `gof-patterns.md` assigns Mediator to `ComposeMediator`: it coordinates the
 * composer's three colleagues — since `FRONTEND-013` the text box, the
 * attachment picker and the media-upload widget — "so they never reference
 * each other directly". Three controls each needing to know what the other two
 * are doing is the case the pattern exists for, and the alternative — each
 * importing the others — is the connection-rule violation this codebase keeps
 * writing tests against.
 *
 * The colleague names are `"text"`, `"attachment"` and `"media"`. The
 * attachment picker reports `{ kind: "link-attached", link }` (which also
 * replaces any link already there) and `{ kind: "link-removed" }`; the old
 * `"mentions"` colleague and its `mention-inserted` event are gone with the
 * dropdown. The draft carries the link as `dataLink` (`null` for none).
 *
 * The Memento: the mediator captures a `DraftSnapshot` before each attach or
 * replace, and `undo()` walks back one at a time — the previous link, then
 * none (the "rollback before attaching live event data" the pattern doc
 * names).
 *
 * `getDraft()`/`subscribe()` are the `useSyncExternalStore` pair, which is why
 * the referential-stability test below is not pedantry: a `getDraft()` that
 * returns a fresh object every call makes React re-render forever.
 */
import { describe, expect, it, vi } from "vitest";

import type { DataLink } from "../../test/attach";
import { ComposeMediator } from "./ComposeMediator";
import { emptyDraft, type Draft } from "./draft";
import { PostTemplate } from "./PostTemplate";

// Frozen, so a mediator that kept the object it was handed cannot let one
// test change what the next one compares against.
const GAME: DataLink = Object.freeze({ type: "game_final", ref_id: 501 });
const LINE: DataLink = Object.freeze({ type: "player_game", ref_id: 80001 });
const CAREER: DataLink = Object.freeze({
  type: "player_career",
  ref_id: 2544,
  scope: "regular",
});

describe("the shared draft", () => {
  it("starts empty, with no link", () => {
    expect(new ComposeMediator().getDraft()).toEqual(emptyDraft());
    expect(new ComposeMediator().getDraft().dataLink).toBeNull();
  });

  it("can be started with reply context the composer was opened in", () => {
    const mediator = new ComposeMediator({ replyToPostId: 77 });

    expect(mediator.getDraft()).toEqual({ ...emptyDraft(), replyToPostId: 77 });
  });

  it("is the same object until something changes it", () => {
    // `useSyncExternalStore` compares the snapshot by identity; a new object per
    // call is an infinite render loop, not a failing assertion.
    const mediator = new ComposeMediator();

    expect(mediator.getDraft()).toBe(mediator.getDraft());

    const before = mediator.getDraft();
    mediator.send("text", { kind: "text-changed", text: "Raptors" });

    expect(mediator.getDraft()).not.toBe(before);
  });
});

describe("the text box talks to the others through the mediator", () => {
  it("puts what was typed on the shared draft", () => {
    const mediator = new ComposeMediator();

    mediator.send("text", { kind: "text-changed", text: "Raptors win" });

    expect(mediator.getDraft().text).toBe("Raptors win");
  });

  it("leaves a typed #GameId123 exactly as typed", () => {
    // The dropdown that rewrote mention runs is gone; text is text.
    const mediator = new ComposeMediator();

    mediator.send("text", {
      kind: "text-changed",
      text: "Raptors win #GameId123",
    });

    expect(mediator.getDraft().text).toBe("Raptors win #GameId123");
    expect(mediator.getDraft().dataLink).toBeNull();
    expect(mediator.canUndo()).toBe(false);
  });

  it("tells every subscriber that the draft changed", () => {
    const mediator = new ComposeMediator();
    const listener = vi.fn();
    mediator.subscribe(listener);

    mediator.send("text", { kind: "text-changed", text: "Raptors win" });

    expect(listener).toHaveBeenCalled();
  });

  it("stops telling a subscriber that unsubscribed", () => {
    const mediator = new ComposeMediator();
    const listener = vi.fn();
    const unsubscribe = mediator.subscribe(listener);

    unsubscribe();
    mediator.send("text", { kind: "text-changed", text: "Raptors win" });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("the media widget talks to the others through the mediator", () => {
  it("attaches a media id to the shared draft", () => {
    const mediator = new ComposeMediator();

    mediator.send("media", { kind: "media-attached", mediaId: 4242 });

    expect(mediator.getDraft().mediaIds).toEqual([4242]);
  });

  it("detaches one again", () => {
    const mediator = new ComposeMediator();
    mediator.send("media", { kind: "media-attached", mediaId: 4242 });

    mediator.send("media", { kind: "media-detached", mediaId: 4242 });

    expect(mediator.getDraft().mediaIds).toEqual([]);
  });

  it("notifies subscribers, so the text box can see an attachment it never imported", () => {
    const mediator = new ComposeMediator();
    const listener = vi.fn();
    mediator.subscribe(listener);

    mediator.send("media", { kind: "media-attached", mediaId: 4242 });

    expect(listener).toHaveBeenCalled();
  });
});

describe("the attachment picker talks to the others through the mediator", () => {
  it("puts an attached link on the shared draft", () => {
    const mediator = new ComposeMediator();

    mediator.send("attachment", { kind: "link-attached", link: GAME });

    expect(mediator.getDraft().dataLink).toEqual(GAME);
  });

  it("replaces the link when another is attached", () => {
    const mediator = new ComposeMediator();
    mediator.send("attachment", { kind: "link-attached", link: GAME });

    mediator.send("attachment", { kind: "link-attached", link: CAREER });

    expect(mediator.getDraft().dataLink).toEqual(CAREER);
  });

  it("clears the link when it is removed", () => {
    const mediator = new ComposeMediator();
    mediator.send("attachment", { kind: "link-attached", link: GAME });

    mediator.send("attachment", { kind: "link-removed" });

    expect(mediator.getDraft().dataLink).toBeNull();
  });

  it("leaves the text and the media alone", () => {
    const mediator = new ComposeMediator();
    mediator.send("media", { kind: "media-attached", mediaId: 4242 });
    mediator.send("text", { kind: "text-changed", text: "Raptors win" });

    mediator.send("attachment", { kind: "link-attached", link: GAME });

    expect(mediator.getDraft().text).toBe("Raptors win");
    expect(mediator.getDraft().mediaIds).toEqual([4242]);
  });

  it("holds its own copy of the link, not the picker's object", () => {
    const mediator = new ComposeMediator();
    const link: DataLink = { type: "game_final", ref_id: 501 };

    mediator.send("attachment", { kind: "link-attached", link });
    link.ref_id = 999;

    expect(mediator.getDraft().dataLink).toEqual(GAME);
  });

  it("publishes a new draft object, and notifies subscribers", () => {
    const mediator = new ComposeMediator();
    const listener = vi.fn();
    mediator.subscribe(listener);
    const before = mediator.getDraft();

    mediator.send("attachment", { kind: "link-attached", link: GAME });

    expect(mediator.getDraft()).not.toBe(before);
    expect(listener).toHaveBeenCalled();
  });
});

describe("undo, after live-event data is attached", () => {
  it("has nothing to undo before a link is attached", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "Raptors win" });
    mediator.send("media", { kind: "media-attached", mediaId: 4242 });

    expect(mediator.canUndo()).toBe(false);
  });

  it("offers an undo once a link is attached", () => {
    const mediator = new ComposeMediator();

    mediator.send("attachment", { kind: "link-attached", link: GAME });

    expect(mediator.canUndo()).toBe(true);
  });

  it("restores the exact prior draft — text, media ids, repost context and no link", () => {
    const mediator = new ComposeMediator({ repostOfPostId: 9 });
    mediator.send("media", { kind: "media-attached", mediaId: 4242 });
    mediator.send("text", { kind: "text-changed", text: "Raptors win" });
    // Written out rather than read back from the mediator: comparing the
    // mediator against its own object would pass even if undo did nothing.
    const before: Draft = {
      text: "Raptors win",
      mediaIds: [4242],
      replyToPostId: null,
      repostOfPostId: 9,
      dataLink: null,
    };

    mediator.send("attachment", { kind: "link-attached", link: GAME });
    mediator.undo();

    expect(mediator.getDraft()).toEqual(before);
  });

  it("walks back a replace to the previous link, then to none", () => {
    const mediator = new ComposeMediator();
    mediator.send("attachment", { kind: "link-attached", link: GAME });
    mediator.send("attachment", { kind: "link-attached", link: LINE });

    mediator.undo();
    expect(mediator.getDraft().dataLink).toEqual(GAME);
    expect(mediator.canUndo()).toBe(true);

    mediator.undo();
    expect(mediator.getDraft().dataLink).toBeNull();
    expect(mediator.canUndo()).toBe(false);
  });

  it("restores a link that nothing done to a later draft can reach", () => {
    const mediator = new ComposeMediator();
    mediator.send("attachment", { kind: "link-attached", link: { ...GAME } });
    const attached = mediator.getDraft().dataLink as DataLink;
    mediator.send("attachment", { kind: "link-attached", link: LINE });
    attached.ref_id = 1;

    mediator.undo();

    expect(mediator.getDraft().dataLink).toEqual(GAME);
  });

  it("notifies subscribers when it rolls back", () => {
    const mediator = new ComposeMediator();
    mediator.send("attachment", { kind: "link-attached", link: GAME });
    const listener = vi.fn();
    mediator.subscribe(listener);

    mediator.undo();

    expect(listener).toHaveBeenCalled();
  });
});

describe("loading and clearing the draft", () => {
  it("takes a whole draft, which is how a quick-post template is applied", () => {
    const mediator = new ComposeMediator();
    const template = new PostTemplate("Pre-game hype", {
      text: "Tip-off soon: ",
    });

    mediator.loadDraft(template.clone());

    expect(mediator.getDraft().text).toBe("Tip-off soon: ");
  });

  it("does not keep a reference to the draft it was handed, link included", () => {
    const mediator = new ComposeMediator();
    const draft: Draft = {
      text: "seed",
      mediaIds: [5],
      replyToPostId: null,
      repostOfPostId: null,
      dataLink: { type: "game_final", ref_id: 501 },
    };

    mediator.loadDraft(draft);
    draft.mediaIds.push(6);
    (draft.dataLink as DataLink).ref_id = 999;

    expect(mediator.getDraft().mediaIds).toEqual([5]);
    expect(mediator.getDraft().dataLink).toEqual(GAME);
  });

  it("empties everything on reset, the link and the undo history included", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "Raptors win" });
    mediator.send("attachment", { kind: "link-attached", link: GAME });
    mediator.send("media", { kind: "media-attached", mediaId: 4242 });

    mediator.reset();

    expect(mediator.getDraft()).toEqual(emptyDraft());
    expect(mediator.canUndo()).toBe(false);
  });

  it("notifies subscribers on reset, so a successful post clears every control", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "Raptors win" });
    const listener = vi.fn();
    mediator.subscribe(listener);

    mediator.reset();

    expect(listener).toHaveBeenCalled();
  });
});
