/**
 * FRONTEND-002 acceptance criterion 2 — the one implementation.
 *
 * SDK behavior uses the real pinned Cognito library with its HTTP intercepted
 * by MSW. Synthetic localStorage tokens exercise session restoration without
 * credentials, SDK mocks, or a real pool.
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
import { HttpResponse, http } from "msw";

import { config } from "../config";
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
  "reauthenticate",
  "emailVerified",
  "requestEmailVerification",
  "confirmEmailVerification",
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

const USERNAME = "synthetic-user";
const CLIENT_ID = config.cognitoClientId;
const COGNITO_URL = `https://cognito-idp.${config.cognitoRegion}.amazonaws.com/`;
const CACHE_PREFIX = `CognitoIdentityServiceProvider.${CLIENT_ID}`;

function syntheticJwt(tokenUse: "id" | "access", expired = false): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = expired ? now - 3600 : now + 3600;
  const payload = tokenUse === "id"
    ? { sub: "synthetic-subject", email: "synthetic@example.invalid", email_verified: false, exp, iat: now, token_use: "id" }
    : { sub: "synthetic-subject", exp, iat: now, token_use: "access", username: USERNAME };
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.synthetic-signature`;
}

function storeSyntheticSession(expired = false): void {
  const userPrefix = `${CACHE_PREFIX}.${USERNAME}`;
  window.localStorage.setItem(`${CACHE_PREFIX}.LastAuthUser`, USERNAME);
  window.localStorage.setItem(`${userPrefix}.idToken`, syntheticJwt("id", expired));
  window.localStorage.setItem(`${userPrefix}.accessToken`, syntheticJwt("access", expired));
  window.localStorage.setItem(`${userPrefix}.refreshToken`, "synthetic-refresh-token");
  window.localStorage.setItem(`${userPrefix}.clockDrift`, "0");
}

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

  it("restores the current SDK user session before requesting email verification", async () => {
    storeSyntheticSession();
    const targets: string[] = [];
    server.use(http.post(COGNITO_URL, async ({ request }) => {
      targets.push(request.headers.get("x-amz-target") ?? "");
      return HttpResponse.json({ CodeDeliveryDetails: { AttributeName: "email", DeliveryMedium: "EMAIL", Destination: "s***@example.invalid" } });
    }));

    await expect(new CognitoAuthService().requestEmailVerification()).resolves.toBeUndefined();
    expect(targets).toEqual(["AWSCognitoIdentityProviderService.GetUserAttributeVerificationCode"]);
  });

  it("rejects without an API request when no valid current-user session can be restored", async () => {
    window.localStorage.setItem(`${CACHE_PREFIX}.LastAuthUser`, USERNAME);
    const targets: string[] = [];
    server.use(http.post(COGNITO_URL, async ({ request }) => {
      targets.push(request.headers.get("x-amz-target") ?? "");
      return HttpResponse.json({});
    }));

    await expect(new CognitoAuthService().requestEmailVerification()).rejects.toBeDefined();
    expect(targets).toEqual([]);
  });

  it("rejects an expired session without requesting an email verification code", async () => {
    storeSyntheticSession(true);
    // Without a refresh token, the SDK rejects the expired cached session
    // locally instead of trying its refresh-token HTTP flow.
    window.localStorage.removeItem(`${CACHE_PREFIX}.${USERNAME}.refreshToken`);
    const targets: string[] = [];
    server.use(http.post(COGNITO_URL, async ({ request }) => {
      targets.push(request.headers.get("x-amz-target") ?? "");
      return HttpResponse.json(
        { __type: "NotAuthorizedException", message: "Synthetic expired session" },
        { status: 400 },
      );
    }));

    await expect(new CognitoAuthService().requestEmailVerification()).rejects.toBeDefined();
    expect(targets).not.toContain(
      "AWSCognitoIdentityProviderService.GetUserAttributeVerificationCode",
    );
  });

  it("rejects when Cognito returns an SDK API error", async () => {
    storeSyntheticSession();
    server.use(http.post(COGNITO_URL, () => HttpResponse.json(
      { __type: "LimitExceededException", message: "Request limit exceeded" },
      { status: 400 },
    )));

    await expect(new CognitoAuthService().requestEmailVerification()).rejects.toMatchObject({
      code: "LimitExceededException",
    });
  });
});
