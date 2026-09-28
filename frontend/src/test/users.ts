import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";
import { testProfile } from "./auth";

/**
 * The `users/` network fixtures `FRONTEND-003` needs: the public profile read,
 * the follow set, follow/unfollow, and `PATCH /users/me`.
 *
 * `src/test/auth.tsx` already owns `GET /users/me` (as `profileFound` /
 * `profileMissing`) and `GET /events/teams`; nothing here duplicates those. What
 * it does add is a *counting* `GET /users/me`, because two of this unit's
 * assertions are about how many times that one shared query was asked
 * ([[0x08-frontend]] — the profile is one react-query entry, not two).
 *
 * **Why the paths are regular expressions.** A wildcard path ending
 * `/users/:userId` matches `/users/me` too — `:userId` is just a path segment,
 * and "me" is a perfectly good one. A handler registered for the public profile
 * would then answer the caller's own profile read, or not, depending on which
 * `server.use` ran last. A regular expression that only accepts digits makes the
 * two reads disjoint by construction, so no test has to think about handler
 * order.
 *
 * Nothing here mocks `apiClient` or `fetch`: these are network handlers, so
 * every test exercising them runs the real generated client.
 */

type MeOut = components["schemas"]["MeOut"];
type PublicUserOut = components["schemas"]["PublicUserOut"];
type UpdateMeRequest = components["schemas"]["UpdateMeRequest"];

/** `GET /users/{user_id}` — digits only, so it can never match `/users/me`. */
const PUBLIC_PROFILE_PATH = /\/users\/(\d+)$/;
/** `POST`/`DELETE /users/{user_id}/follow`, same reasoning. */
const FOLLOW_PATH = /\/users\/(\d+)\/follow$/;

/** The user whose public profile this unit's tests view. Not the signed-in one. */
export const VIEWED_USER_ID = 42;

/**
 * A distinct username per id.
 *
 * The heading of a profile page is the username, so this is what lets a test
 * assert that the id *in the path* is the id that was fetched, rather than a
 * fixed one that happens to be right.
 */
export function usernameForId(userId: number): string {
  return `courtside${userId}`;
}

export const VIEWED_USERNAME = usernameForId(VIEWED_USER_ID);

/**
 * `GET /users/{user_id}` returns `PublicUserOut` — **no `date_of_birth`**
 * ([[0x01-users]] PII fix). The type is the generated one, so a fixture that
 * grew the field would not compile.
 */
export function publicProfile(overrides: Partial<PublicUserOut> = {}): PublicUserOut {
  return {
    id: VIEWED_USER_ID,
    username: VIEWED_USERNAME,
    description: "Courtside since the Vince era.",
    preferred_team_id: 2,
    profile_picture_media_id: null,
    created_at: "2026-02-14T00:00:00Z",
    follower_count: 3,
    following_count: 5,
    ...overrides,
  };
}

export interface PublicProfileStub {
  handler: RequestHandler;
  /** The user id of every `GET /users/{id}` the page issued, in order. */
  readonly requests: number[];
  /** Answer every subsequent read with this profile instead. */
  answerWith(profile: PublicUserOut): void;
}

/** `GET /users/{user_id}` → 200, recording which ids were asked for. */
export function publicProfileStub(profile: PublicUserOut = publicProfile()): PublicProfileStub {
  const requests: number[] = [];
  let answer = profile;

  return {
    handler: http.get(PUBLIC_PROFILE_PATH, ({ request }) => {
      requests.push(userIdIn(request.url, PUBLIC_PROFILE_PATH));
      return HttpResponse.json<PublicUserOut>(answer);
    }),
    requests,
    answerWith(next: PublicUserOut): void {
      answer = next;
    },
  };
}

/**
 * `GET /users/{user_id}` → 200 for any id, answering with *that id's* profile.
 *
 * The one handler a sweep over several ids needs.
 */
export function publicProfilesById(): RequestHandler {
  return http.get(PUBLIC_PROFILE_PATH, ({ request }) => {
    const id = userIdIn(request.url, PUBLIC_PROFILE_PATH);
    return HttpResponse.json<PublicUserOut>(publicProfile({ id, username: usernameForId(id) }));
  });
}

export interface MeStub {
  handler: RequestHandler;
  /** One entry per `GET /users/me`. The shared query means this should be 1, not 2. */
  readonly requests: string[];
}

/** `GET /users/me` → 200, counting the reads. `profileFound()` when the count does not matter. */
export function meStub(profile: MeOut = testProfile()): MeStub {
  const requests: string[] = [];

  return {
    handler: http.get("*/users/me", ({ request }) => {
      requests.push(request.url);
      return HttpResponse.json<MeOut>(profile);
    }),
    requests,
  };
}

/**
 * `GET /users/me` → 404, counting the reads.
 *
 * "Authenticated, no profile row yet" — a routing state, not an error
 * ([[0x08-frontend]]). `profileMissing()` when the count does not matter.
 */
export function meMissingStub(): MeStub {
  const requests: string[] = [];

  return {
    handler: http.get("*/users/me", ({ request }) => {
      requests.push(request.url);
      return HttpResponse.json({ detail: "Not Found" }, { status: 404 });
    }),
    requests,
  };
}

export interface FollowingStub {
  handler: RequestHandler;
  /** One entry per `GET /users/me/following`. */
  readonly requests: string[];
  /** Answer every subsequent read with this set instead. */
  answerWith(ids: number[]): void;
}

/** `GET /users/me/following` → the ids the caller follows ([[0x01-users]]: a bare `list[int]`). */
export function followingStub(ids: number[] = []): FollowingStub {
  const requests: string[] = [];
  let answer = ids;

  return {
    handler: http.get("*/users/me/following", ({ request }) => {
      requests.push(request.url);
      return HttpResponse.json<number[]>(answer);
    }),
    requests,
    answerWith(next: number[]): void {
      answer = next;
    },
  };
}

export interface FollowCall {
  method: "POST" | "DELETE";
  userId: number;
}

export interface FollowStub {
  /** Both halves of `/users/{user_id}/follow` — install them together. */
  handlers: RequestHandler[];
  /** Every follow/unfollow the page issued, in order. */
  readonly calls: FollowCall[];
  /**
   * Hold every follow/unfollow open until the returned function is called, so a
   * test can assert what the button says *before* the request returns rather
   * than racing it. Always release before the test ends.
   */
  hold(): () => void;
  /** Answer every follow/unfollow with a 500 from here on. */
  fail(): void;
}

/** `POST`/`DELETE /users/{user_id}/follow` → 204, per the generated schema. */
export function followStub(): FollowStub {
  const calls: FollowCall[] = [];
  let gate: Promise<void> | null = null;
  let failing = false;

  async function respond(method: "POST" | "DELETE", url: string): Promise<Response> {
    // Recorded before the gate, so a held call is still observable as "sent".
    calls.push({ method, userId: userIdIn(url, FOLLOW_PATH) });
    if (gate !== null) await gate;
    if (failing) return HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 });
    return new HttpResponse(null, { status: 204 });
  }

  return {
    handlers: [
      http.post(FOLLOW_PATH, ({ request }) => respond("POST", request.url)),
      http.delete(FOLLOW_PATH, ({ request }) => respond("DELETE", request.url)),
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

export interface PatchMeStub {
  handler: RequestHandler;
  /** The parsed body of every `PATCH /users/me`, in order. */
  readonly bodies: UpdateMeRequest[];
  /** The one body the form sent, or a failure naming that it sent none. */
  onlyBody(): UpdateMeRequest;
  /** Answer every subsequent write with this profile instead. */
  answerWith(profile: MeOut): void;
}

/**
 * `PATCH /users/me` → 200 `MeOut`, keeping the **parsed body** so a test can ask
 * whether a key was present at all.
 *
 * That distinction is the whole point: `model_fields_set` semantics mean an
 * absent field is left untouched while an explicit `null` clears it
 * ([[0x01-users]]), so "did not send it" and "sent null" are different requests
 * and only the raw body tells them apart.
 */
export function patchMeStub(profile: MeOut = testProfile()): PatchMeStub {
  const bodies: UpdateMeRequest[] = [];
  let answer = profile;

  return {
    handler: http.patch("*/users/me", async ({ request }) => {
      bodies.push((await request.json()) as UpdateMeRequest);
      return HttpResponse.json<MeOut>(answer);
    }),
    bodies,
    onlyBody(): UpdateMeRequest {
      if (bodies.length !== 1) {
        throw new Error(`expected exactly one PATCH /users/me, saw ${bodies.length}`);
      }
      return bodies[0];
    },
    answerWith(next: MeOut): void {
      answer = next;
    },
  };
}

/** The `{user_id}` the request was for, read from the path the handler matched. */
function userIdIn(url: string, pattern: RegExp): number {
  const matched = pattern.exec(new URL(url).pathname);
  if (matched === null) throw new Error(`no user id in ${url}`);
  return Number(matched[1]);
}
