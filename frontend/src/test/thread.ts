import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";
import type { AppRouter } from "./app-route";
import { testPost } from "./compose";
import { threadIdOf, type ThreadView } from "./feed";

/**
 * The thread modal's network kit (`FRONTEND-010`): a `GET /feed/thread/{id}`
 * stub whose answers a test can change, hold and fail, and a `POST /posts`
 * stub for the reply composer that can be held and failed too.
 *
 * `./feed`'s `threadStub` answers a fixed set of threads forever, which was
 * enough for the old "Show replies" disclosure. The modal needs more: a reply
 * that lands has to come back in the *next* read of the thread, and a failed
 * read has to be retryable, so this stub is a small mutable server. Fixtures
 * are `./feed`'s (`testPostView`, `threadView`) and the `PostOut` body is
 * `./compose`'s `testPost`; nothing here duplicates either.
 */

type CreatePostRequest = components["schemas"]["CreatePostRequest"];
type PostOut = components["schemas"]["PostOut"];

/** Hold-open gate shared by both stubs: the call is recorded before it waits. */
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

export interface ThreadServer {
  handler: RequestHandler;
  /** The `post_id` of every `GET /feed/thread/{post_id}`, in order. */
  readonly requests: number[];
  /** Add or replace the thread answered for its root's id (`threadIdOf`). */
  set(thread: ThreadView): void;
  /** Hold every read open until the returned function is called. */
  hold(): () => void;
  /** Answer every read with a 500 from here on. */
  fail(): void;
  /** Stop failing: answer from the threads again. */
  recover(): void;
}

/**
 * `GET /feed/thread/{post_id}` → 200 with the thread for that root, 404 for a
 * post it does not have (an unknown post, or one whose author was removed —
 * [[0x06-feed]] Routes), or 500 while failing.
 */
export function threadServer(threads: ThreadView[] = []): ThreadServer {
  const requests: number[] = [];
  const byRootId = new Map(
    threads.map((thread) => [threadIdOf(thread), thread]),
  );
  const held = gate();
  let failing = false;

  return {
    handler: http.get<{ post_id: string }>(
      "*/feed/thread/:post_id",
      async ({ params }) => {
        const postId = Number(params.post_id);
        requests.push(postId);
        await held.wait();
        if (failing) {
          return HttpResponse.json(
            { detail: "Internal Server Error" },
            { status: 500 },
          );
        }
        const thread = byRootId.get(postId);
        if (thread === undefined) {
          return HttpResponse.json({ detail: "Not Found" }, { status: 404 });
        }
        return HttpResponse.json<ThreadView>(thread);
      },
    ),
    requests,
    set(thread: ThreadView): void {
      byRootId.set(threadIdOf(thread), thread);
    },
    hold: held.hold,
    fail(): void {
      failing = true;
    },
    recover(): void {
      failing = false;
    },
  };
}

export interface ReplyStubOptions {
  /** The 201 body. */
  post?: PostOut;
  /**
   * Called once the reply is created, before the 201 goes back — where a test
   * changes what the feed and thread stubs answer next, so the server's own
   * view moves only when the reply actually exists.
   */
  onCreated?: (body: CreatePostRequest) => void;
}

export interface ReplyStub {
  handler: RequestHandler;
  /** Every `POST /posts` body, in order (recorded before the gate). */
  readonly bodies: CreatePostRequest[];
  /** Hold every `POST /posts` open until the returned function is called. */
  hold(): () => void;
  /** Answer every `POST /posts` with a 500 from here on. */
  fail(): void;
}

/** `POST /posts` → 201, for the reply composer. */
export function replyStub(options: ReplyStubOptions = {}): ReplyStub {
  const { post = testPost({ is_reply: true }), onCreated } = options;
  const bodies: CreatePostRequest[] = [];
  const held = gate();
  let failing = false;

  return {
    handler: http.post("*/posts", async ({ request }) => {
      const body = (await request.clone().json()) as CreatePostRequest;
      bodies.push(body);
      await held.wait();
      if (failing) {
        return HttpResponse.json(
          { detail: "the post could not be saved" },
          { status: 500 },
        );
      }
      onCreated?.(body);
      return HttpResponse.json<PostOut>(post, { status: 201 });
    }),
    bodies,
    hold: held.hold,
    fail(): void {
      failing = true;
    },
  };
}

/** The address a navigation's `state.background` carries, if any. */
export interface BackgroundLocation {
  pathname: string;
  search: string;
}

/** `state.background` of the router's current location, or `null`. */
export function backgroundOf(router: AppRouter): BackgroundLocation | null {
  const state = router.state.location.state as {
    background?: BackgroundLocation;
  } | null;
  return state?.background ?? null;
}

/** The `<dialog>` the thread is open in, or `null` when none is. */
export function openDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>("dialog[open]");
}

/** Every `<article>` outside any `<dialog>`: the page underneath the modal. */
export function articlesUnderneath(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("article")].filter(
    (article) => article.closest("dialog") === null,
  );
}

/** The top-level card underneath the modal holding `text`. */
export function cardUnderneath(text: string): HTMLElement {
  const card = articlesUnderneath().find(
    (article) =>
      article.parentElement?.closest("article") === null &&
      (article.textContent ?? "").includes(text),
  );
  if (card === undefined)
    throw new Error(`no card underneath containing ${JSON.stringify(text)}`);
  return card;
}

/** The link around a card's own timestamp — the keyboard path to its thread. */
export function timestampLink(card: HTMLElement): HTMLAnchorElement {
  const time = card.querySelector("time");
  if (time === null) throw new Error("no <time> in the card");
  const link = time.closest("a");
  if (link === null) throw new Error("the card's <time> is not inside a link");
  return link;
}
