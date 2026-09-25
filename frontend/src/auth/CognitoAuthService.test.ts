/**
 * FRONTEND-002 acceptance criterion 2 — the one implementation.
 *
 * What is *not* tested here: anything that would require the Cognito SDK to be
 * mocked. The library's own network is out of scope by decision
 * (`.ai/tasks/FRONTEND-002/brief.md`, "Verification") — msw covers the API, the
 * `AuthService` double covers the seam, and a real browser against the real dev
 * pool covers Cognito. A test that reached inside `CognitoUser` would pin the
 * mock and tell us nothing.
 *
 * What is left is worth pinning, because two later things depend on it:
 *
 * - the surface exists and is the interface's, so `App` can inject this object
 *   where an `AuthService` is expected;
 * - **with nothing in storage, the signed-out answers cost no network call.**
 *   `AuthProvider` asks for the session on mount, and `src/App.test.tsx`
 *   renders the real `<App />` with no Cognito handler in scope. If a cold start
 *   hit the network, that file — which this unit may not edit — would start
 *   failing for a reason nobody would look for.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { server } from "../test/server";
import type { AuthService } from "./AuthService";
import { CognitoAuthService } from "./CognitoAuthService";

const SURFACE = [
  "signUp",
  "confirmSignUp",
  "resendConfirmationCode",
  "signIn",
  "signOut",
  "forgotPassword",
  "confirmForgotPassword",
  "refreshSession",
  "getIdToken",
] as const;

/** Every URL the suite saw while the callback ran. */
async function recordRequests(run: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    seen.push(request.url);
  };
  server.events.on("request:start", listener);
  try {
    await run();
  } finally {
    server.events.removeListener("request:start", listener);
  }
  return seen;
}

beforeEach(() => {
  // The SDK's accepted v1 token store is `localStorage` (brief, "Token
  // storage"). A cold start is the state under test, so it starts empty.
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("CognitoAuthService", () => {
  it("is constructed from configuration alone, with no arguments", () => {
    // Pool id and client id come from `config`, which is the one reader of the
    // build-time environment. A constructor that took them as arguments would
    // give every call site a chance to pass something else.
    const service = new CognitoAuthService();

    expect(service).toBeInstanceOf(CognitoAuthService);
  });

  it("implements the whole AuthService surface", () => {
    const service: AuthService = new CognitoAuthService();
    const methods = service as unknown as Record<string, unknown>;

    for (const method of SURFACE) {
      expect(typeof methods[method], `CognitoAuthService.${method} is missing`).toBe("function");
    }
  });

  it("reports no id token, and makes no request, when nothing is stored", async () => {
    const service = new CognitoAuthService();
    let token: string | null = "not yet read";

    const requests = await recordRequests(async () => {
      token = await service.getIdToken();
    });

    expect(token).toBeNull();
    expect(requests, "a signed-out cold start must not talk to Cognito").toEqual([]);
  });

  it("restores no session, and makes no request, when nothing is stored", async () => {
    const service = new CognitoAuthService();
    let session: unknown = "not yet read";

    const requests = await recordRequests(async () => {
      session = await service.refreshSession();
    });

    expect(session).toBeNull();
    expect(requests).toEqual([]);
  });

  it("signs out without a session and without throwing", () => {
    const service = new CognitoAuthService();

    expect(() => service.signOut()).not.toThrow();
  });
});
