/**
 * The two properties that make an ordinary `import` work in a test.
 *
 * Neither is about a feature. Both are about the harness behaving the same on a
 * developer's machine and inside `frontend-test`, and both were found the
 * expensive way: a test that statically imported a module reaching `config.ts`
 * or `api/client.ts` passed locally and could not pass in the container.
 *
 * They are pinned here rather than written down, because a note in the wiki
 * saying "always dynamic-import the subject under test" is a rule every future
 * unit has to remember. A red test is not.
 */
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

// Both imports are static and at module scope on purpose: that is the thing
// under test. Neither file may be moved into a hook or a dynamic import here.
import { apiClient } from "../api/client";
import { config } from "../config";
import { server } from "./server";

describe("the test environment supplies every VITE_* value", () => {
  it("loads config.ts on a static import, with no .env file present", () => {
    // `config.ts` throws at module load on a missing variable, so reaching this
    // line at all is half the assertion. CI and the container have no env file;
    // `vite.config.ts`'s `test.env` is what stands in for one.
    expect(config.apiBaseUrl).toBe("/api");
    expect(config.cognitoRegion).toBe("eu-west-2");
    expect(config.mediaBaseUrl).toBe("https://media.test.invalid");
  });

  it("uses the committed placeholders rather than whatever .env.local holds", () => {
    // `.env.[mode]` outranks `.env.local`, so a test never sees the real dev
    // pool. If `test.env` is removed, this reads the developer's own pool id
    // locally and fails, and fails differently in the container — either way,
    // red where the defect is.
    expect(config.cognitoUserPoolId).toBe("eu-west-2_TESTPOOL");
    expect(config.cognitoClientId).toBe("test-spa-client-id");
  });
});

describe("msw intercepts a client built at module load", () => {
  it("serves a statically imported apiClient from a handler, not the network", async () => {
    // `createClient` captures `globalThis.fetch` when it runs, and `apiClient`
    // is constructed at module load — before any `beforeAll`. If `setupTests`
    // moves `server.listen()` back into a hook, this request leaves for the
    // real network and fails with ECONNREFUSED instead of returning the body.
    server.use(http.get("*/health", () => HttpResponse.json({ status: "ok" })));

    const { data, error } = await apiClient.GET("/health");

    expect(error).toBeUndefined();
    expect(data).toEqual({ status: "ok" });
  });
});
