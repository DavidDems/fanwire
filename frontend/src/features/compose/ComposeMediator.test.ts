/**
 * FRONTEND-004 acceptance criterion 2 (behavioural half) and criterion 4
 * (the undo).
 *
 * `gof-patterns.md` assigns Mediator to `ComposeMediator`: it coordinates the
 * text box, the mention-autocomplete dropdown and the media-upload widget "so
 * they never reference each other directly". Three controls each needing to know
 * what the other two are doing is the case the pattern exists for, and the
 * alternative — each importing the others — is the connection-rule violation
 * this codebase keeps writing tests against.
 *
 * The structural half of criterion 2 is `component-isolation.test.ts`, and per
 * the brief that one is worth more than this file. What is pinned here is that
 * the mediator is actually the *route* between the three: a colleague reports
 * what it did, and the shared draft — the only state any of them reads — changes
 * as a result.
 *
 * `getDraft()`/`subscribe()` are the `useSyncExternalStore` pair, which is why
 * the referential-stability test below is not pedantry: a `getDraft()` that
 * returns a fresh object every call makes React re-render forever.
 */
import { describe, expect, it, vi } from "vitest";

import { ComposeMediator } from "./ComposeMediator";
import { emptyDraft, type Draft } from "./draft";
import { PostTemplate } from "./PostTemplate";

describe("the shared draft", () => {
  it("starts empty", () => {
    expect(new ComposeMediator().getDraft()).toEqual(emptyDraft());
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

describe("the autocomplete talks to the text box through the mediator", () => {
  it("replaces the mention being typed with the chosen token", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "Raptors win #12" });

    mediator.send("mentions", {
      kind: "mention-inserted",
      token: "#GameId123",
    });

    // Trailing space: the next thing the user types is a word, not part of the
    // token, and `activeMentionQuery` treats the space as closing it.
    expect(mediator.getDraft().text).toBe("Raptors win #GameId123 ");
  });

  it("replaces a team query the same way", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "Big night for $to" });

    mediator.send("mentions", { kind: "mention-inserted", token: "$TOR" });

    expect(mediator.getDraft().text).toBe("Big night for $TOR ");
  });

  it("writes the token into an empty box", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "#" });

    mediator.send("mentions", {
      kind: "mention-inserted",
      token: "#GameId123",
    });

    expect(mediator.getDraft().text).toBe("#GameId123 ");
  });

  it("leaves an attachment alone while it rewrites the text", () => {
    const mediator = new ComposeMediator();
    mediator.send("media", { kind: "media-attached", mediaId: 4242 });
    mediator.send("text", { kind: "text-changed", text: "Raptors win #12" });

    mediator.send("mentions", {
      kind: "mention-inserted",
      token: "#GameId123",
    });

    expect(mediator.getDraft().mediaIds).toEqual([4242]);
  });
});

describe("undo, after live-event data is attached", () => {
  it("has nothing to undo before a mention is inserted", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "Raptors win" });
    mediator.send("media", { kind: "media-attached", mediaId: 4242 });

    expect(mediator.canUndo()).toBe(false);
  });

  it("offers an undo once a mention is inserted", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "Raptors win #12" });

    mediator.send("mentions", {
      kind: "mention-inserted",
      token: "#GameId123",
    });

    expect(mediator.canUndo()).toBe(true);
  });

  it("restores the exact prior draft — text, media ids and reply context", () => {
    const mediator = new ComposeMediator({ replyToPostId: 77 });
    mediator.send("media", { kind: "media-attached", mediaId: 4242 });
    mediator.send("text", { kind: "text-changed", text: "Raptors win #12" });
    // Written out rather than read back from the mediator: comparing the
    // mediator against its own object would pass even if undo did nothing.
    const before: Draft = {
      text: "Raptors win #12",
      mediaIds: [4242],
      replyToPostId: 77,
      repostOfPostId: null,
    };

    mediator.send("mentions", {
      kind: "mention-inserted",
      token: "#GameId123",
    });
    mediator.undo();

    expect(mediator.getDraft()).toEqual(before);
  });

  it("walks back one insertion at a time", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "#" });
    mediator.send("mentions", {
      kind: "mention-inserted",
      token: "#GameId123",
    });
    mediator.send("text", { kind: "text-changed", text: "#GameId123 $to" });
    mediator.send("mentions", { kind: "mention-inserted", token: "$TOR" });

    mediator.undo();
    expect(mediator.getDraft().text).toBe("#GameId123 $to");

    mediator.undo();
    expect(mediator.getDraft().text).toBe("#");
    expect(mediator.canUndo()).toBe(false);
  });

  it("notifies subscribers when it rolls back", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "#" });
    mediator.send("mentions", {
      kind: "mention-inserted",
      token: "#GameId123",
    });
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

  it("does not keep a reference to the draft it was handed", () => {
    const mediator = new ComposeMediator();
    const draft: Draft = {
      text: "seed",
      mediaIds: [5],
      replyToPostId: null,
      repostOfPostId: null,
    };

    mediator.loadDraft(draft);
    draft.mediaIds.push(6);

    expect(mediator.getDraft().mediaIds).toEqual([5]);
  });

  it("empties everything on reset, including the undo history", () => {
    const mediator = new ComposeMediator();
    mediator.send("text", { kind: "text-changed", text: "#" });
    mediator.send("mentions", {
      kind: "mention-inserted",
      token: "#GameId123",
    });
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
