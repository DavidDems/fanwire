/**
 * FRONTEND-002 acceptance criterion 3 — the ID token reaches the wire.
 *
 * FRONTEND-001 shipped `setTokenProvider` as a seam and a default of
 * "anonymous". This unit fills it: `installTokenProvider(service)` makes every
 * subsequent `apiClient` request carry the *current* ID token, and carry no
 * `Authorization` header at all when there is no session.
 *
 * The header is asserted on the wire through msw, against the real generated
 * `openapi-fetch` client — never by inspecting a mock. "No header at all" is
 * asserted as absence: `Bearer null` and `Bearer ` are both rejected by the
 * backend verifier, which would break the guest feed for a reason nobody would
 * look for ([[0x08-frontend]], "Contracts the foundation pins").
 */
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "../api/client";
import { FakeAuthService, TEST_ID_TOKEN, testSession } from "../test/auth";
import { server } from "../test/server";
import { installTokenProvider } from "./tokenProvider";

interface Seen {
  authorization: string | null;
  hasAuthorization: boolean;
}

let seen: Seen[] = [];

function recordHealthRequests(): void {
  server.use(
    http.get("*/health", ({ request }) => {
      seen.push({
        authorization: request.headers.get("authorization"),
        hasAuthorization: request.headers.has("authorization"),
      });
      return HttpResponse.json({ status: "ok" });
    }),
  );
}

beforeEach(() => {
  seen = [];
  recordHealthRequests();
});

describe("installTokenProvider", () => {
  it("sends the service's id token as a Bearer credential", async () => {
    installTokenProvider(new FakeAuthService({ session: testSession() }));

    await apiClient.GET("/health");

    expect(seen[0].authorization).toBe(`Bearer ${TEST_ID_TOKEN}`);
  });

  it("sends no Authorization header at all when there is no session", async () => {
    installTokenProvider(new FakeAuthService());

    await apiClient.GET("/health");

    expect(seen[0].hasAuthorization).toBe(false);
    expect(seen[0].authorization).toBeNull();
  });

  it("asks the service again on every request rather than caching a token", async () => {
    // Cognito rotates the id token, and signing out has to take effect on the
    // next request — not on the next page load.
    const service = new FakeAuthService({ session: testSession() });
    installTokenProvider(service);

    await apiClient.GET("/health");
    service.signOut();
    await apiClient.GET("/health");

    expect(seen.map((request) => request.hasAuthorization)).toEqual([true, false]);
    expect(seen[0].authorization).toBe(`Bearer ${TEST_ID_TOKEN}`);
  });

  it("reads the token through getIdToken, the interface's own accessor", async () => {
    const service = new FakeAuthService({ session: testSession() });
    installTokenProvider(service);

    await apiClient.GET("/health");

    expect(service.callsTo("getIdToken")).toHaveLength(1);
  });
});
