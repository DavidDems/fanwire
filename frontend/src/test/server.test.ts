/**
 * FRONTEND-001 acceptance criterion 10 — the msw test harness.
 *
 * The point of `onUnhandledRequest: "error"` is that a request nobody wrote a
 * handler for is a *test failure*, not a silent pass. Without it, a component
 * that quietly calls the wrong endpoint still renders its loading state, the
 * assertion about the loading state still passes, and the suite says nothing.
 *
 * The first test here is load-bearing for the second: it proves msw is actually
 * intercepting. Without it, "an unhandled request rejects" would also pass if
 * the server were never started at all — jsdom's own fetch rejects against an
 * unreachable host, and the test would be green for entirely the wrong reason.
 *
 * "Handlers are typed against `paths` from the generated schema" is a
 * compile-time property; `npm run typecheck` is what enforces it.
 */
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "./server";

const HANDLED = "https://fanwire.test/deliberately-handled";
const UNHANDLED = "https://fanwire.test/deliberately-unhandled";

describe("the shared msw server", () => {
  it("is a setupServer instance the suite can drive", () => {
    expect(typeof server.listen).toBe("function");
    expect(typeof server.use).toBe("function");
    expect(typeof server.resetHandlers).toBe("function");
    expect(typeof server.close).toBe("function");
  });

  it("intercepts a request that has a handler", async () => {
    server.use(http.get(HANDLED, () => HttpResponse.json({ intercepted: true })));

    const response = await fetch(HANDLED);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ intercepted: true });
  });

  it("fails an unhandled request rather than letting it pass silently", async () => {
    await expect(fetch(UNHANDLED)).rejects.toThrow();
  });
});
