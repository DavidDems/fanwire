import { HttpResponse, http, type RequestHandler } from "msw";
import { expect } from "vitest";

import avatarStyles from "../components/ui/Avatar.module.css";

/**
 * The two failure responses the profile settings card has to explain
 * (`UI-008`): the teams list that would not load, and the save that did not
 * land. `src/test/auth.tsx` owns the 200 for `GET /events/teams` and
 * `src/test/users.ts` the 200 for `PATCH /users/me`; these are only the 500s.
 *
 * Network handlers, like every other fixture here: nothing mocks `apiClient`
 * or `fetch`.
 */

const SERVER_ERROR = { detail: "Internal Server Error" };

/** `GET /events/teams` → 500. */
export function teamsFail(): RequestHandler {
  return http.get("*/events/teams", () =>
    HttpResponse.json(SERVER_ERROR, { status: 500 }),
  );
}

/** `PATCH /users/me` → 500. */
export function patchMeFails(): RequestHandler {
  return http.patch("*/users/me", () =>
    HttpResponse.json(SERVER_ERROR, { status: 500 }),
  );
}

/**
 * USERS-005: an Avatar in `scope` (the whole document by default) shows the
 * colour rule for `inner` and `outer`: the inner token as its fill with the
 * palette's black as its text, the outer token as its ring, or neither for
 * null. jsdom computes no stylesheet, so this reads the inline style the
 * Avatar sets by token name.
 */
export function expectAvatarColours(
  inner: string | null,
  outer: string | null,
  scope: ParentNode = document,
): HTMLElement {
  const avatars = [
    ...scope.querySelectorAll<HTMLElement>(`.${avatarStyles.avatar}`),
  ];
  expect(avatars.length, "an Avatar is rendered").toBeGreaterThan(0);
  const wanted = {
    backgroundColor: inner === null ? "" : `var(--team-inner-${inner})`,
    color: inner === null ? "" : "var(--team-outer-black)",
    borderColor: outer === null ? "" : `var(--team-outer-${outer})`,
  };
  const seen = avatars.map(({ style }) => ({
    backgroundColor: style.backgroundColor,
    color: style.color,
    borderColor: style.borderColor,
  }));
  expect(seen, "an Avatar with these colours").toContainEqual(wanted);
  const index = seen.findIndex(
    (one) =>
      one.backgroundColor === wanted.backgroundColor &&
      one.color === wanted.color &&
      one.borderColor === wanted.borderColor,
  );
  return avatars[index];
}
