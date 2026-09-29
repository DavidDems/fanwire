/**
 * FRONTEND-002 acceptance criteria 1, 2 and 3 — where the one implementation is
 * chosen.
 *
 * Every other test in this unit injects a double, which is the point of the
 * interface and also the gap: nothing in a double-injected test would notice if
 * the application itself never wired the real service up. Exactly one place is
 * allowed to know which implementation the app runs on, and that place is
 * `App`. So that is asserted here, from the file itself.
 *
 * The behavioural half matters more than it looks. `src/App.test.tsx` renders
 * the real `<App />` with no Cognito handler in scope, and this unit may not
 * edit that file — it is FRONTEND-001's. If a cold start reached the *auth*
 * layer, that suite would go red for a reason nobody would connect to this
 * change.
 *
 * This test file lives under `src/auth/` rather than beside `App.tsx` because
 * the auth wiring is what it is about, and because `src/App.test.tsx` is not
 * this unit's to extend.
 *
 * **What the cold-start assertion pins, and what it used to over-pin.** It was
 * written as "no request at all", which was an accurate spelling of the
 * guarantee only while `/` rendered a static placeholder. `FRONTEND-005` makes
 * the default route a real feed that reads `GET /feed` when it mounts — a
 * public read path by decision ([[0x06-feed]] Security), and nothing to do with
 * auth. The empty array was therefore pinning the placeholder, not the
 * property. What this file is actually about is that a cold start does not ask
 * **who the visitor is**: no `GET /users/me`, no Cognito call, no guard
 * blocking on a session that does not exist. So that is what it now says, and
 * the feed's own read is the one request it tolerates — anything else is still
 * a failure.
 */
import { render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../App";
import { server, type GetResponseBody } from "../test/server";

function findSrcDir(): string {
  for (const candidate of [join(process.cwd(), "src"), join(process.cwd(), "frontend", "src")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot locate frontend/src from ${process.cwd()}`);
}

const APP_FILE = join(findSrcDir(), "App.tsx");

let requests: string[] = [];

function onRequestStart({ request }: { request: Request }): void {
  requests.push(request.url);
}

beforeEach(() => {
  requests = [];
  window.localStorage.clear();
  server.events.on("request:start", onRequestStart);
  // The default route is the feed, and it reads `GET /feed` when it mounts.
  // Inlined rather than taken from `src/test/feed.ts`, because this file has to
  // keep passing on a checkout where that fixture does not exist yet.
  server.use(
    http.get("*/feed", () =>
      HttpResponse.json<GetResponseBody<"/feed">>({ items: [], next_before_id: null }),
    ),
  );
});

afterEach(() => {
  server.events.removeListener("request:start", onRequestStart);
  window.localStorage.clear();
});

describe("App wires the real auth service in, once", () => {
  it("mounts the provider, the Cognito implementation and the token provider", () => {
    const source = readFileSync(APP_FILE, "utf8");

    expect(source, "App must put an AuthProvider around the router").toContain("AuthProvider");
    expect(
      source,
      "App is the one place that chooses the implementation — there is no environment branch anywhere else",
    ).toContain("CognitoAuthService");
    expect(
      source,
      "apiClient's token provider has to be installed from the same service the pages use",
    ).toContain("installTokenProvider");
  });

  it("renders the guest feed on a cold start without asking who the visitor is", async () => {
    // The guest feed is reachable signed out ([[0x01-users]]: viewing is a
    // public read path), so a cold start must not block on, or provoke, a call
    // about the visitor's identity. The feed's own read is not such a call.
    render(<App />);

    expect(await screen.findByRole("heading", { name: /feed/i })).toBeInTheDocument();

    // Named explicitly rather than matched loosely: `GET /users/me` is the one
    // request a signed-out cold start must never make, because a guard that
    // asks it without a session is the bug that sends a returning visitor to
    // the sign-in page on every reload ([[0x08-frontend]] — `status` has three
    // values and `"loading"` is one of them).
    expect(
      requests.filter((url) => url.includes("/users/me")),
      "a signed-out cold start never asks who you are",
    ).toEqual([]);

    // And nothing else either. The feed is the only read the default route is
    // entitled to make, so anything beyond it is a request this file exists to
    // catch — the assertion stays exhaustive, it just stopped being a count of
    // zero.
    expect(
      requests.filter((url) => !url.includes("/feed")),
      "the feed's own read is the only request a cold start may provoke",
    ).toEqual([]);
  });
});
