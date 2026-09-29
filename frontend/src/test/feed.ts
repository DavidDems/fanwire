import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";

/**
 * The feed unit's network kit: fixtures and msw handler factories for the three
 * endpoints `features/feed/` touches — `GET /feed`, `GET /feed/thread/{post_id}`
 * and `POST`/`DELETE /posts/{post_id}/like`.
 *
 * Everything is typed against the generated schema, so a fixture that drifts
 * from `backend/openapi.json` is a typecheck failure rather than a suite that
 * passes against a body the backend never sends. `PostView` is `feed/`'s own
 * response shape and is deliberately not `PostOut` ([[0x06-feed]] View
 * assembly) — it carries the author, the like data, the media, the mentioned
 * game ids and the live scores that `PostOut` does not.
 *
 * `src/test/auth.tsx` already owns `GET /users/me` and `GET /events/teams`, and
 * `src/test/compose.ts` owns the media and post-creation endpoints; nothing here
 * duplicates either. Nothing here mocks `apiClient` or `fetch`: these are
 * network handlers, so every test using them exercises the real generated
 * client.
 */

/**
 * Re-exported under this unit's names so a test file states a fixture's type
 * without restating the schema path. `FeedPage` is the API's *body* type and
 * `FeedPage` is also this unit's page component, so the body is `FeedPageBody`
 * here — the same type either way, named so a test can import both.
 */
export type AuthorView = components["schemas"]["AuthorView"];
export type FeedPageBody = components["schemas"]["FeedPage"];
export type LiveScoreView = components["schemas"]["LiveScoreView"];
export type MediaItemView = components["schemas"]["MediaItemView"];
export type PostView = components["schemas"]["PostView"];
export type ThreadView = components["schemas"]["ThreadView"];

/**
 * `POST`/`DELETE /posts/{post_id}/like`, as a regular expression.
 *
 * Same reasoning as `src/test/users.ts`: a wildcard path ending
 * `/posts/:post_id/like` would also match a path whose `post_id` segment is a
 * word, and the ids this unit asserts on are read back out of the path. Digits
 * only makes the match and the id one decision instead of two.
 */
const LIKE_PATH = /\/posts\/(\d+)\/like$/;

/** The `s3_key_public` a media fixture carries — `media/{id}/…` per [[0x04-media]]. */
export const TEST_PUBLIC_MEDIA_KEY = "media/5150/full.jpg";

/** The `s3_key_thumbnail` beside it, so a test can tell the two keys apart. */
export const TEST_FEED_THUMBNAIL_KEY = "media/5150/thumb.jpg";

export function testAuthor(overrides: Partial<AuthorView> = {}): AuthorView {
  return {
    id: 11,
    username: "courtside11",
    profile_picture_media_id: null,
    ...overrides,
  };
}

/** One processed image on a post. `s3_key_public` is what the feed renders from. */
export function testMediaItem(overrides: Partial<MediaItemView> = {}): MediaItemView {
  return {
    id: 5150,
    s3_key_public: TEST_PUBLIC_MEDIA_KEY,
    s3_key_thumbnail: TEST_FEED_THUMBNAIL_KEY,
    ...overrides,
  };
}

/** A live score for a mentioned game — only ever present inside the 4h window. */
export function testLiveScore(overrides: Partial<LiveScoreView> = {}): LiveScoreView {
  return {
    game_id: 123,
    home_score: 112,
    away_score: 108,
    status: "Q4",
    ...overrides,
  };
}

/**
 * A feed item.
 *
 * The defaults are the plainest possible post: no media, no live scores, no
 * mentions, not a reply and not a repost. `like_count` is 3 rather than 0 or 1
 * so that a test which likes and unlikes stays on plural counts in both
 * directions and never accidentally pins a singular label.
 */
export function testPostView(overrides: Partial<PostView> = {}): PostView {
  return {
    id: 101,
    text: "Raptors in six",
    author: testAuthor(),
    is_reply: false,
    parent_post_id: null,
    is_repost: false,
    original_post_id: null,
    created_at: "2026-09-28T12:00:00Z",
    like_count: 3,
    liked_by_viewer: false,
    media: [],
    mentioned_game_ids: [],
    live_scores: [],
    ...overrides,
  };
}

/** `GET /feed`'s body: the items, and the cursor for the page after them. */
export function feedPage(items: PostView[] = [], nextBeforeId: number | null = null): FeedPageBody {
  return { items, next_before_id: nextBeforeId };
}

/** `GET /feed/thread/{post_id}`'s body: the root plus its **direct** replies. */
export function threadView(root: PostView, replies: PostView[] = []): ThreadView {
  return { root, replies };
}

export interface FeedRequest {
  /** `before_id` exactly as it appeared in the query string, or `null` if absent. */
  beforeId: string | null;
  /**
   * The whole query string. Two visitors' requests are compared whole rather
   * than parameter by parameter: the criterion is that a guest and a signed-in
   * user send the *same* request, and a parameter only one of them sends is
   * precisely the failure ([[0x06-feed]] — the API picks the strategy).
   */
  search: string;
  /**
   * Whatever `api/client.ts`'s middleware attached. The feed never sets this
   * itself, so it is recorded to show what did *not* differ, not to pin a token.
   */
  authorization: string | null;
}

export interface FeedStub {
  handler: RequestHandler;
  /** Every `GET /feed` the page issued, in order. */
  readonly requests: FeedRequest[];
  /**
   * Answer every subsequent read with this page instead, discarding the rest of
   * the schedule. The server is what decides the like counts, so this is how a
   * test says "and then the server's own view of the post looked like this".
   */
  answerWith(page: FeedPageBody): void;
}

/**
 * `GET /feed` → 200.
 *
 * `pages` are answered in order and the last one repeats forever, so a single
 * page is a constant and two pages are a feed that ends on the second. The
 * cursor is not simulated: the *test* asserts that `before_id` carried the
 * previous response's `next_before_id`, which is the criterion, and a stub that
 * derived the page from the cursor would answer correctly even for a page the
 * component asked for wrongly.
 */
export function feedStub(pages: FeedPageBody[] = [feedPage()]): FeedStub {
  const requests: FeedRequest[] = [];
  let schedule = pages;
  let served = 0;

  return {
    handler: http.get("*/feed", ({ request }) => {
      const url = new URL(request.url);
      requests.push({
        beforeId: url.searchParams.get("before_id"),
        search: url.search,
        authorization: request.headers.get("Authorization"),
      });

      const page = schedule[Math.min(served, schedule.length - 1)];
      served += 1;
      return HttpResponse.json<FeedPageBody>(page);
    }),
    requests,
    answerWith(page: FeedPageBody): void {
      schedule = [page];
      served = 0;
    },
  };
}

export interface ThreadStub {
  handler: RequestHandler;
  /** The `post_id` of every `GET /feed/thread/{post_id}`, in order. */
  readonly requests: number[];
}

/**
 * `GET /feed/thread/{post_id}` → 200 for each thread given, keyed by its root's
 * id; 404 for anything else.
 *
 * The 404 is deliberate. The endpoint returns the root plus **direct** replies
 * only ([[0x06-feed]] Routes), so a component that expanded a reply by asking
 * for some other post's thread is asking for a thread this fixture does not
 * have — and a visible failure is what should happen, rather than an answer that
 * makes the wrong request look right.
 */
export function threadStub(threads: ThreadView[]): ThreadStub {
  const requests: number[] = [];
  const byRootId = new Map(threads.map((thread) => [thread.root.id, thread]));

  return {
    handler: http.get<{ post_id: string }>("*/feed/thread/:post_id", ({ params }) => {
      const postId = Number(params.post_id);
      requests.push(postId);

      const thread = byRootId.get(postId);
      if (thread === undefined) {
        return HttpResponse.json({ detail: "Not Found" }, { status: 404 });
      }
      return HttpResponse.json<ThreadView>(thread);
    }),
    requests,
  };
}

export interface LikeCall {
  method: "POST" | "DELETE";
  postId: number;
}

export interface LikeStub {
  /** Both halves of `/posts/{post_id}/like` — install them together. */
  handlers: RequestHandler[];
  /** Every like/unlike the page issued, in order. */
  readonly calls: LikeCall[];
  /**
   * Hold every like/unlike open until the returned function is called, so a test
   * can assert what the control says *before* the request returns rather than
   * racing it. Always release before the test ends.
   */
  hold(): () => void;
  /** Answer every like/unlike with a 500 from here on. */
  fail(): void;
}

/**
 * `POST`/`DELETE /posts/{post_id}/like` → 204, per the generated schema.
 *
 * Same shape as `followStub` in `src/test/users.ts`, and for the same reason:
 * "optimistic" means the state and the count move *before* the response lands,
 * and the only way to assert that rather than race it is to hold the request
 * open from the network side.
 */
export function likeStub(): LikeStub {
  const calls: LikeCall[] = [];
  let gate: Promise<void> | null = null;
  let failing = false;

  async function respond(method: "POST" | "DELETE", url: string): Promise<Response> {
    // Recorded before the gate, so a held call is still observable as "sent".
    calls.push({ method, postId: postIdIn(url) });
    if (gate !== null) await gate;
    if (failing) return HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 });
    return new HttpResponse(null, { status: 204 });
  }

  return {
    handlers: [
      http.post(LIKE_PATH, ({ request }) => respond("POST", request.url)),
      http.delete(LIKE_PATH, ({ request }) => respond("DELETE", request.url)),
    ],
    calls,
    hold(): () => void {
      let open = (): void => {};
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        open();
        gate = null;
      };
    },
    fail(): void {
      failing = true;
    },
  };
}

/**
 * `GET /feed` → an empty first page, for a test that renders the app somewhere
 * else and only needs the feed not to be an unhandled request.
 */
export function emptyFeed(): RequestHandler {
  return http.get("*/feed", () => HttpResponse.json<FeedPageBody>(feedPage([], null)));
}

/** The `{post_id}` a like/unlike was for, read from the path the handler matched. */
function postIdIn(url: string): number {
  const matched = LIKE_PATH.exec(new URL(url).pathname);
  if (matched === null) throw new Error(`no post id in ${url}`);
  return Number(matched[1]);
}
