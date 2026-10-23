import { waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { HttpResponse, http, type RequestHandler } from "msw";
import { expect, onTestFinished, vi, type Mock } from "vitest";

import { testProfile } from "./auth";
import {
  feedPage,
  testAuthor,
  testPostView,
  type FeedPageBody,
  type PostView,
} from "./feed";

/**
 * The post menu's kit (`FRONTEND-012`): finding a card's "More options" menu,
 * stubbing the clipboard Copy link writes to, and the two post-lifecycle
 * writes the menu sends — `POST /posts/{id}/report` and `DELETE /posts/{id}`
 * (`POSTS-004`, [[0x03-posts]]).
 *
 * **The interface it reads.** Every post card has exactly one button named
 * "More options" (`aria-haspopup`, `aria-expanded`). Opened, it shows a
 * `role="menu"` *inside the same card* whose items are `role="menuitem"`:
 * "Copy link" always, "Report" (or "Reported", disabled, once sent) for a
 * signed-in active viewer on another member's post, and "Delete" on the
 * viewer's own post. Nothing here reads whether the list is a `popover` — jsdom
 * implements no Popover API, so what is asserted is the reader's view: the
 * button's state, the items and where focus is.
 *
 * Same network idiom as `./feed` and `./thread`: handlers record the call
 * before any gate, so a held request is still observable as sent, and nothing
 * mocks `apiClient` or `fetch`.
 */

/** The accessible name of every card's menu button. */
export const MORE_OPTIONS = "More options";

/** The signed-in member `./app-route`'s `member` visitor is (`testProfile()`). */
export const OWN_AUTHOR = testAuthor({
  id: testProfile().id,
  username: testProfile().username,
});

/** A post by the signed-in member: the one kind a Delete is offered on. */
export function ownPost(overrides: Partial<PostView> = {}): PostView {
  return testPostView({ author: OWN_AUTHOR, ...overrides });
}

/** The card's own menu button (exactly one, or this throws). */
export function menuButton(card: HTMLElement): HTMLElement {
  return within(card).getByRole("button", { name: MORE_OPTIONS });
}

/** Open the card's menu and return it, once the button says it is expanded. */
export async function openMenu(
  user: UserEvent,
  card: HTMLElement,
): Promise<HTMLElement> {
  const button = menuButton(card);
  await user.click(button);
  await waitFor(() => expect(button).toHaveAttribute("aria-expanded", "true"));
  return within(card).getByRole("menu");
}

/** The accessible names of a menu's items, in order. */
export function itemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

/**
 * Disabled as a reader is told it is: the `disabled` attribute on a native
 * button, or `aria-disabled="true"` on an item kept focusable for the arrow
 * keys. Either is a disabled menu item; neither may act.
 */
export function isDisabled(element: HTMLElement): boolean {
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true"
  );
}

/** The absolute address Copy link writes: this origin, then `/posts/<id>`. */
export function postAddress(postId: number): string {
  return `${window.location.origin}/posts/${postId}`;
}

export type ClipboardMode = "writes" | "refuses" | "missing";

/**
 * Put a clipboard on `navigator` for this test only: one whose `writeText`
 * resolves (`writes`), one whose `writeText` rejects as a browser does when
 * permission is refused (`refuses`), or none at all (`missing`, jsdom's own
 * state and an insecure context's).
 *
 * **Call it after `userEvent.setup()`**: `setup()` attaches a clipboard stub of
 * its own to `navigator`, and whichever is defined last is the one the page
 * sees. The previous descriptor is put back when the test finishes.
 */
export function stubClipboard(
  mode: ClipboardMode,
): Mock<(text: string) => Promise<void>> {
  const writeText = vi.fn<(text: string) => Promise<void>>(() =>
    mode === "writes"
      ? Promise.resolve()
      : Promise.reject(
          new DOMException("Write permission denied.", "NotAllowedError"),
        ),
  );
  const previous = Object.getOwnPropertyDescriptor(
    window.navigator,
    "clipboard",
  );
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: mode === "missing" ? undefined : { writeText },
  });
  onTestFinished(() => {
    if (previous === undefined) {
      Reflect.deleteProperty(window.navigator, "clipboard");
    } else {
      Object.defineProperty(window.navigator, "clipboard", previous);
    }
  });
  return writeText;
}

/** `POST /posts/{post_id}/report` and `DELETE /posts/{post_id}`, digits only (see `./feed`). */
const REPORT_PATH = /\/posts\/(\d+)\/report$/;
const POST_PATH = /\/posts\/(\d+)$/;

function idIn(url: string, pattern: RegExp): number {
  const matched = pattern.exec(new URL(url).pathname);
  if (matched === null) throw new Error(`no post id in ${url}`);
  return Number(matched[1]);
}

function gate(): { wait: () => Promise<void>; hold: () => () => void } {
  let current: Promise<void> | null = null;
  return {
    wait: async () => {
      if (current !== null) await current;
    },
    hold: () => {
      let open = (): void => {};
      current = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        open();
        current = null;
      };
    },
  };
}

export interface PostWriteStub {
  handler: RequestHandler;
  /** The post id of every request, in order (recorded before the gate). */
  readonly calls: number[];
  /** Hold every request open until the returned function is called. */
  hold(): () => void;
  /** Answer every request with `status` from here on (500 by default). */
  fail(status?: number): void;
}

/**
 * `POST /posts/{post_id}/report` → 204. Idempotent on the server (a repeat
 * report is another 204), which is why "Reported" is only this session's
 * memory: `PostView` carries no "already reported" field.
 */
export function reportStub(): PostWriteStub {
  const calls: number[] = [];
  const held = gate();
  let failing: number | null = null;

  return {
    handler: http.post(REPORT_PATH, async ({ request }) => {
      calls.push(idIn(request.url, REPORT_PATH));
      await held.wait();
      if (failing !== null) {
        return HttpResponse.json(
          { detail: "Report failed" },
          { status: failing },
        );
      }
      return new HttpResponse(null, { status: 204 });
    }),
    calls,
    hold: held.hold,
    fail(status = 500): void {
      failing = status;
    },
  };
}

export interface DeletePostStubOptions {
  /**
   * Called once the post is deleted, before the 204 goes back — where a test
   * changes what the feed, search and thread stubs answer next, so the
   * server's own view moves only when the deletion actually happened.
   */
  onDeleted?: (postId: number) => void;
}

/**
 * `DELETE /posts/{post_id}` → 204 (`POSTS-004`): 204 again on a repeat; the
 * failures a test can ask for are the route's own — 403 (not the caller's
 * post), 404 (no such post) and 409 (a plain repost, which `DELETE
 * …/repost` removes instead).
 */
export function deletePostStub(
  options: DeletePostStubOptions = {},
): PostWriteStub {
  const calls: number[] = [];
  const held = gate();
  let failing: number | null = null;

  return {
    handler: http.delete(POST_PATH, async ({ request }) => {
      const postId = idIn(request.url, POST_PATH);
      calls.push(postId);
      await held.wait();
      if (failing !== null) {
        return new HttpResponse(null, { status: failing });
      }
      options.onDeleted?.(postId);
      return new HttpResponse(null, { status: 204 });
    }),
    calls,
    hold: held.hold,
    fail(status = 500): void {
      failing = status;
    },
  };
}

export interface FeedServer {
  handler: RequestHandler;
  /** One entry per `GET /feed`. */
  readonly requests: string[];
  /** Answer every read from here on with this page. */
  answerWith(page: FeedPageBody): void;
  /** Hold every read open until the returned function is called. */
  hold(): () => void;
}

/**
 * `GET /feed` → one page, changeable and holdable. `./feed`'s `feedStub` cannot
 * be held, and "the card leaves at once" is only observable while the refetch
 * after the deletion has not answered yet.
 */
export function feedServer(page: FeedPageBody = feedPage()): FeedServer {
  const requests: string[] = [];
  const held = gate();
  let answer = page;

  return {
    handler: http.get("*/feed", async ({ request }) => {
      requests.push(request.url);
      await held.wait();
      return HttpResponse.json<FeedPageBody>(answer);
    }),
    requests,
    answerWith(next: FeedPageBody): void {
      answer = next;
    },
    hold: held.hold,
  };
}
