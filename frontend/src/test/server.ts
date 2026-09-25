import { HttpResponse, http, type RequestHandler } from "msw";
import { setupServer } from "msw/node";

import type { paths } from "../api/schema";

/**
 * The shared msw server. Tests mock the *network*, never the client, so every
 * test exercises the real generated `openapi-fetch` client, middleware and all.
 *
 * `setupTests.ts` starts this with `onUnhandledRequest: "error"` — a request
 * nobody wrote a handler for is a test failure, not a silent pass.
 */

/** The `get` operation the generated schema declares for `Path`. */
type GetOperation<Path extends keyof paths> = paths[Path] extends { get: infer Operation }
  ? Operation
  : never;

/**
 * The 200 `application/json` body of a GET, taken from the generated schema —
 * so a handler that returns the wrong shape is a typecheck failure rather than
 * a test that passes against a body the backend never sends.
 */
export type GetResponseBody<Path extends keyof paths> =
  GetOperation<Path> extends {
    responses: { 200: { content: { "application/json": infer Body } } };
  }
    ? Body
    : never;

/**
 * Defaults only — anything a test actually asserts on belongs in that test, via
 * `server.use`. `/health` is here because it is true of every environment and
 * costs nothing.
 */
export const handlers: RequestHandler[] = [
  http.get("*/health", () => HttpResponse.json<GetResponseBody<"/health">>({ status: "ok" })),
];

export const server = setupServer(...handlers);
