import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";
import { testProfile } from "./auth";
import { publicProfile, usernameForId } from "./users";

/**
 * The `notifications/` network fixtures `FRONTEND-006` needs: the list, the
 * clear (a soft delete the UI never exposes as one), the email preference, and a
 * *counting* `GET /users/{user_id}` for the actors named in each entry.
 *
 * Everything is typed against the generated schema, so a fixture that drifts
 * from `backend/openapi.json` is a typecheck failure rather than a suite that
 * passes against a body the backend never sends.
 *
 * **Why the actor read is duplicated here rather than imported.**
 * `src/test/users.ts` already has `publicProfilesById()`, but it does not count,
 * and one of this unit's acceptance criteria is entirely about *how many* times
 * a given actor was asked for. The username scheme is not duplicated — it comes
 * from `usernameForId`/`publicProfile` in that file, so both units agree on who
 * user 42 is.
 *
 * **Why the paths are regular expressions.** Same reasoning as `users.ts`: a
 * digits-only pattern can never match `/users/me`, so no test has to think about
 * the order two handlers were registered in. `/notifications` and
 * `/notifications/preference` are anchored for the same reason — a wildcard for
 * the list that also swallowed the preference read would answer it with an array
 * and leave the toggle looking like a rendering bug.
 *
 * Nothing here mocks `apiClient` or `fetch`: these are network handlers, so
 * every test using them exercises the real generated client.
 */

type NotificationOut = components["schemas"]["NotificationOut"];
type NotificationType = components["schemas"]["NotificationType"];
type NotificationPreferenceOut = components["schemas"]["NotificationPreferenceOut"];
type UpdateNotificationPreferenceRequest =
  components["schemas"]["UpdateNotificationPreferenceRequest"];
type PublicUserOut = components["schemas"]["PublicUserOut"];

/** `GET /notifications` — anchored, so it cannot also match the preference read. */
const NOTIFICATIONS_PATH = /\/notifications$/;
/** `GET`/`PUT /notifications/preference`. */
const PREFERENCE_PATH = /\/notifications\/preference$/;
/** `POST /notifications/{notification_id}/clear`. */
const CLEAR_PATH = /\/notifications\/(\d+)\/clear$/;
/** `GET /users/{user_id}` — digits only, so it can never match `/users/me`. */
const PUBLIC_PROFILE_PATH = /\/users\/(\d+)$/;

/**
 * Whose notifications these are: the signed-in user from `testProfile()`.
 *
 * Read from that fixture rather than written down again, so the recipient in a
 * notification body and the caller `GET /users/me` describes cannot drift apart.
 */
export const RECIPIENT_USER_ID = testProfile().id;

/** The actor most fixtures here are from. Not the recipient, and not 42. */
export const ACTOR_USER_ID = 11;

/** A `Post.id` — what a reply or repost notification's `reference_id` points at. */
export const REFERENCED_POST_ID = 900;

/**
 * A notification row.
 *
 * `reply` by default, because that is the type whose `reference_id` genuinely
 * carries something other than the actor — `followNotification` below derives
 * the `follow` case from it rather than leaving the two free to disagree.
 */
export function testNotification(overrides: Partial<NotificationOut> = {}): NotificationOut {
  return {
    id: 1,
    recipient_user_id: RECIPIENT_USER_ID,
    actor_user_id: ACTOR_USER_ID,
    type: "reply",
    reference_id: REFERENCED_POST_ID,
    created_at: "2026-09-25T12:00:00Z",
    ...overrides,
  };
}

/**
 * A `follow`, whose `reference_id` **is** the actor's own user id
 * ([[0x05-notifications]] `reference_id` semantics — kept for uniform click-target
 * semantics even though it is redundant there).
 *
 * Derived rather than passed in, so no test can describe a follow that points at
 * a post and then assert the link is a profile.
 */
export function followNotification(overrides: Partial<NotificationOut> = {}): NotificationOut {
  const notification = testNotification({ type: "follow", ...overrides });
  return { ...notification, reference_id: notification.actor_user_id };
}

/** A `reply` — `reference_id` is the new reply `Post.id` ([[0x05-notifications]]). */
export function replyNotification(overrides: Partial<NotificationOut> = {}): NotificationOut {
  return testNotification({ type: "reply", ...overrides });
}

/** A `repost` — `reference_id` is the new repost `Post.id` ([[0x05-notifications]]). */
export function repostNotification(overrides: Partial<NotificationOut> = {}): NotificationOut {
  return testNotification({ type: "repost", ...overrides });
}

/**
 * A `type` value the generated schema does not know.
 *
 * `NotificationType` is the closed set `follow | reply | repost` today
 * ([[0x05-notifications]] business rules, and `schema.d.ts` says so), so there is
 * no honest way to build this fixture without a deliberate cast — TypeScript is
 * right that no such value exists in the contract as committed. The cast is the
 * point rather than a way around one: the criterion is not about what the backend
 * sends today, it is about what this bundle does the day it is served a value it
 * was built before. A list that silently drops the rows it does not understand is
 * indistinguishable from a broken fetch, and a list that throws on one takes the
 * rows it *does* understand down with it.
 *
 * `mention` rather than `like`: `like` is excluded by an actual business rule, so
 * an implementation could reasonably special-case it and still fail the general
 * case this covers.
 */
export const UNKNOWN_NOTIFICATION_TYPE = "mention" as unknown as NotificationType;

export function unknownTypeNotification(
  overrides: Partial<NotificationOut> = {},
): NotificationOut {
  return testNotification({ type: UNKNOWN_NOTIFICATION_TYPE, ...overrides });
}

/** The notification preference body — one flag, and there is no in-app equivalent. */
export function testPreference(enabled: boolean): NotificationPreferenceOut {
  return { email_notifications_enabled: enabled };
}

export interface NotificationsStub {
  handler: RequestHandler;
  /** One entry per `GET /notifications`. */
  readonly requests: string[];
  /** Answer every subsequent read with this list instead. */
  answerWith(notifications: NotificationOut[]): void;
}

/** `GET /notifications` → 200, counting the reads. */
export function notificationsStub(notifications: NotificationOut[] = []): NotificationsStub {
  const requests: string[] = [];
  let answer = notifications;

  return {
    handler: http.get(NOTIFICATIONS_PATH, ({ request }) => {
      requests.push(request.url);
      return HttpResponse.json<NotificationOut[]>(answer);
    }),
    requests,
    answerWith(next: NotificationOut[]): void {
      answer = next;
    },
  };
}

/** `GET /notifications` → 200, for a test that does not care how often it was asked. */
export function notificationsAre(notifications: NotificationOut[] = []): RequestHandler {
  return http.get(NOTIFICATIONS_PATH, () =>
    HttpResponse.json<NotificationOut[]>(notifications),
  );
}

/** `GET /notifications/preference` → 200, for a test that only needs it answered. */
export function preferenceIs(enabled = true): RequestHandler {
  return http.get(PREFERENCE_PATH, () =>
    HttpResponse.json<NotificationPreferenceOut>(testPreference(enabled)),
  );
}

export interface ClearStub {
  handler: RequestHandler;
  /** The `{notification_id}` of every clear the page issued, in order. */
  readonly calls: number[];
  /**
   * Hold every clear open until the returned function is called, so a test can
   * assert what the list looks like *before* the request returns rather than
   * racing it. Always release before the test ends.
   */
  hold(): () => void;
  /** Answer every clear from here on with a 500. Read *after* the gate, so a
   * held request can be failed while it is in flight. */
  fail(): void;
}

/**
 * `POST /notifications/{notification_id}/clear` → 204, per the generated schema.
 *
 * A soft delete on the backend (`cleared_at`, [[0x05-notifications]]); from here
 * it is a 204 and nothing in the UI is supposed to know the difference.
 */
export function clearStub(): ClearStub {
  const calls: number[] = [];
  let gate: Promise<void> | null = null;
  let failing = false;

  return {
    handler: http.post(CLEAR_PATH, async ({ request }) => {
      // Recorded before the gate, so a held call is still observable as "sent".
      calls.push(idIn(request.url, CLEAR_PATH));
      if (gate !== null) await gate;
      if (failing) return HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 });
      return new HttpResponse(null, { status: 204 });
    }),
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

export interface PreferenceStub {
  /** Both halves of `/notifications/preference` — install them together. */
  handlers: RequestHandler[];
  /** One entry per `GET /notifications/preference`. */
  readonly gets: string[];
  /** The parsed body of every `PUT /notifications/preference`, in order. */
  readonly puts: UpdateNotificationPreferenceRequest[];
  /** Answer every write from here on with a 500. */
  fail(): void;
}

/**
 * `GET` and `PUT /notifications/preference`.
 *
 * A successful `PUT` stores what it was sent and answers with it, so a refetch
 * afterwards agrees with the control rather than handing the page back the value
 * the user just changed.
 */
export function preferenceStub(enabled = true): PreferenceStub {
  const gets: string[] = [];
  const puts: UpdateNotificationPreferenceRequest[] = [];
  let stored = enabled;
  let failing = false;

  return {
    handlers: [
      http.get(PREFERENCE_PATH, ({ request }) => {
        gets.push(request.url);
        return HttpResponse.json<NotificationPreferenceOut>(testPreference(stored));
      }),
      http.put(PREFERENCE_PATH, async ({ request }) => {
        const body = (await request.json()) as UpdateNotificationPreferenceRequest;
        puts.push(body);
        if (failing) {
          // The stored value is deliberately left alone: a refetch after a failed
          // write must still report what the server actually has, which is the
          // value the control has to go back to.
          return HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 });
        }
        stored = body.email_notifications_enabled;
        return HttpResponse.json<NotificationPreferenceOut>(testPreference(stored));
      }),
    ],
    gets,
    puts,
    fail(): void {
      failing = true;
    },
  };
}

export interface ActorProfilesStub {
  handler: RequestHandler;
  /** The user id of every `GET /users/{user_id}` the page issued, in order. */
  readonly requests: number[];
  /** How many times `userId` was asked for. One per *actor* is the contract. */
  timesAsked(userId: number): number;
}

/**
 * `GET /users/{user_id}` → 200 for any id, answering with *that id's* profile and
 * counting every read.
 *
 * The counting is the whole reason this exists rather than `publicProfilesById()`:
 * ten notifications from one actor must produce one request, and only a count can
 * tell a stable react-query key from a `useEffect` per row.
 */
export function actorProfilesStub(): ActorProfilesStub {
  const requests: number[] = [];

  return {
    handler: http.get(PUBLIC_PROFILE_PATH, ({ request }) => {
      const id = idIn(request.url, PUBLIC_PROFILE_PATH);
      requests.push(id);
      return HttpResponse.json<PublicUserOut>(publicProfile({ id, username: usernameForId(id) }));
    }),
    requests,
    timesAsked(userId: number): number {
      return requests.filter((id) => id === userId).length;
    },
  };
}

/** The numeric id the request was for, read from the path the handler matched. */
function idIn(url: string, pattern: RegExp): number {
  const matched = pattern.exec(new URL(url).pathname);
  if (matched === null) throw new Error(`no id in ${url}`);
  return Number(matched[1]);
}
