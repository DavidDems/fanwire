import { copyDraft, emptyDraft, type Draft } from "./draft";

/**
 * Prototype — assigned by `wiki/CodeContext/Standards/gof-patterns.md`.
 *
 * Quick posts are cloned from a stored template and then customised, rather than
 * built from scratch. The criterion that matters is independence: a shallow copy
 * that shares the media-id array passes every obvious test and fails on the
 * *second* use of the same template, by which point the first draft's
 * attachments have leaked into it.
 */

/** What a template fixes; everything it leaves out comes from `emptyDraft()`. */
export interface PostTemplateContent {
  text?: string;
  mediaIds?: number[];
}

export class PostTemplate {
  readonly name: string;

  private readonly content: Draft;

  constructor(name: string, content: PostTemplateContent) {
    this.name = name;
    // Copied on the way in as well as on the way out: a template built from a
    // caller's object must not change when that object does.
    this.content = {
      ...emptyDraft(),
      text: content.text ?? "",
      mediaIds: [...(content.mediaIds ?? [])],
    };
  }

  clone(): Draft {
    return copyDraft(this.content);
  }
}

/**
 * The stored quick posts.
 *
 * Deliberately few and deliberately unfinished sentences — a template is a
 * starting point the user types into, not a post. None is named "Post", because
 * the composer's own submit control is.
 */
export const QUICK_POST_TEMPLATES: readonly PostTemplate[] = [
  new PostTemplate("Final score reaction", { text: "What a finish — " }),
  new PostTemplate("Pre-game hype", { text: "Tip-off soon: " }),
  new PostTemplate("Player watch", { text: "Keep an eye on " }),
];
