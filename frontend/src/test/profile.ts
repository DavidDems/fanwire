import { HttpResponse, http, type RequestHandler } from "msw";

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
