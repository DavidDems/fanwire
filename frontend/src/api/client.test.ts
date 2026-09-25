/**
 * FRONTEND-001 acceptance criterion 6 — the typed client's auth middleware.
 *
 * The token comes from an *injected provider*, not from a module-level import
 * of the auth layer: FRONTEND-002 supplies the real Cognito one, this unit
 * ships the seam. So the seam itself is what is pinned here — inject a
 * provider, watch the header on the wire.
 *
 * The network is mocked at the network layer (msw), never the client: these
 * tests exercise the real generated `openapi-fetch` client, middleware and all.
 * A test that mocked `apiClient` would pin the mock.
 *
 * "No Authorization header at all" is asserted as absence, not as an empty
 * string. `Authorization: Bearer null` and `Authorization: ` are both things a
 * backend verifier has to reject with a 401, which is exactly the anonymous
 * feed request breaking for the wrong reason.
 */
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "../test/server";

const REQUIRED_ENV = {
  VITE_API_BASE_URL: "/api",
  VITE_COGNITO_REGION: "eu-west-2",
  VITE_COGNITO_USER_POOL_ID: "eu-west-2_TESTPOOL",
  VITE_COGNITO_CLIENT_ID: "test-spa-client-id",
  VITE_MEDIA_BASE_URL: "https://media.test.invalid",
} as const;

/** Captured per request, so "on every request" can be asserted over a sequence. */
interface Seen {
  authorization: string | null;
  hasAuthorization: boolean;
  url: string;
}

function recorder(seen: Seen[]) {
  return ({ request }: { request: Request }) => {
    seen.push({
      authorization: request.headers.get("authorization"),
      hasAuthorization: request.headers.has("authorization"),
      url: request.url,
    });
    return HttpResponse.json({ status: "ok" });
  };
}

async function loadClient(): Promise<typeof import("./client")> {
  return import("./client");
}

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries(REQUIRED_ENV)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("apiClient", () => {
  it("sends Bearer <token> from the injected provider on every request", async () => {
    const { apiClient, setTokenProvider } = await loadClient();
    const seen: Seen[] = [];
    server.use(http.get("*/health", recorder(seen)), http.get("*/users/me", recorder(seen)));

    setTokenProvider(() => "id-token-from-cognito");
    await apiClient.GET("/health");
    await apiClient.GET("/users/me");

    expect(seen.map((request) => request.authorization)).toEqual([
      "Bearer id-token-from-cognito",
      "Bearer id-token-from-cognito",
    ]);
  });

  it("sends no Authorization header at all when the provider returns null", async () => {
    const { apiClient, setTokenProvider } = await loadClient();
    const seen: Seen[] = [];
    server.use(http.get("*/health", recorder(seen)));

    setTokenProvider(() => null);
    await apiClient.GET("/health");

    expect(seen[0].hasAuthorization).toBe(false);
    expect(seen[0].authorization).toBeNull();
  });

  it("sends no Authorization header before any provider is injected", async () => {
    // The default has to be "anonymous", not "crash" and not a stale token:
    // the guest feed renders before anyone signs in.
    const { apiClient } = await loadClient();
    const seen: Seen[] = [];
    server.use(http.get("*/health", recorder(seen)));

    await apiClient.GET("/health");

    expect(seen[0].hasAuthorization).toBe(false);
  });

  it("awaits an asynchronous token provider", async () => {
    // Cognito's session lookup is asynchronous, so FRONTEND-002's real provider
    // will be. The seam has to take it without a second code path.
    const { apiClient, setTokenProvider } = await loadClient();
    const seen: Seen[] = [];
    server.use(http.get("*/health", recorder(seen)));

    setTokenProvider(async () => "async-id-token");
    await apiClient.GET("/health");

    expect(seen[0].authorization).toBe("Bearer async-id-token");
  });

  // `VITE_API_BASE_URL` is `/api` — relative, same origin, by design. A browser
  // resolves that against the document; the `Request` constructor under vitest
  // does not, and throws `Invalid URL: /api/health` before msw ever sees it. So
  // the client has to resolve the configured base against the current origin
  // (e.g. `new URL(config.apiBaseUrl, window.location.origin)`) rather than
  // handing a relative string to `createClient`. Same-origin either way: this
  // changes nothing about the deployed contract and adds no CORS.
  it("calls the configured base URL, same origin, with no CORS preflight", async () => {
    const { apiClient, setTokenProvider } = await loadClient();
    const seen: Seen[] = [];
    server.use(http.get("*/health", recorder(seen)));

    setTokenProvider(() => null);
    await apiClient.GET("/health");

    expect(new URL(seen[0].url).pathname).toBe("/api/health");
  });
});

describe("createApiClient", () => {
  it("builds an independent client around the provider it is given", async () => {
    // The factory is the seam a test double is injected through; the module
    // singleton is the one the app uses. Both exist, and they do not share
    // provider state.
    const { createApiClient, apiClient, setTokenProvider } = await loadClient();
    const seen: Seen[] = [];
    server.use(http.get("*/health", recorder(seen)));

    setTokenProvider(() => "singleton-token");
    const double = createApiClient(() => "double-token");
    await double.GET("/health");
    await apiClient.GET("/health");

    expect(seen.map((request) => request.authorization)).toEqual([
      "Bearer double-token",
      "Bearer singleton-token",
    ]);
  });
});
