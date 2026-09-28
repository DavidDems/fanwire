/**
 * FRONTEND-004 acceptance criterion 4, the Memento half.
 *
 * `gof-patterns.md` assigns Memento to `DraftSnapshot`: it captures an
 * in-progress draft before a risky action (attaching live event data) so the
 * composer can roll back "without exposing `Post` internals". So what is pinned
 * is the property that makes a memento a memento rather than a variable holding
 * the same object — the captured state is *detached*. A snapshot that stored the
 * caller's draft by reference looks correct right up to the first mutation,
 * which is the point at which undo is needed and the only point at which anyone
 * would notice.
 *
 * The mediator's side of this criterion — capturing before a mention insertion
 * and restoring on undo — is in `ComposeMediator.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { DraftSnapshot } from "./DraftSnapshot";
import type { Draft } from "./draft";

function draftWithEverything(): Draft {
  return {
    text: "Raptors win",
    mediaIds: [11, 12],
    replyToPostId: 77,
    repostOfPostId: null,
  };
}

describe("DraftSnapshot captures a draft", () => {
  it("restores text, media ids and reply context together", () => {
    const snapshot = DraftSnapshot.capture(draftWithEverything());

    expect(snapshot.restore()).toEqual(draftWithEverything());
  });

  it("restores repost context too", () => {
    const draft: Draft = {
      text: "worth reposting",
      mediaIds: [],
      replyToPostId: null,
      repostOfPostId: 9,
    };

    expect(DraftSnapshot.capture(draft).restore()).toEqual(draft);
  });

  it("is unaffected by everything that happens to the draft afterwards", () => {
    const draft = draftWithEverything();
    const snapshot = DraftSnapshot.capture(draft);

    draft.text = `${draft.text} #GameId123 `;
    draft.mediaIds.push(13);
    draft.replyToPostId = null;

    expect(snapshot.restore()).toEqual(draftWithEverything());
  });

  it("hands back a fresh draft on every restore", () => {
    const snapshot = DraftSnapshot.capture(draftWithEverything());

    const first = snapshot.restore();
    first.text = "edited";
    first.mediaIds.push(13);

    expect(snapshot.restore()).toEqual(draftWithEverything());
    expect(snapshot.restore().mediaIds).not.toBe(first.mediaIds);
  });
});
