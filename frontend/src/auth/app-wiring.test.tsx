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
 * the real `<App />` with no Cognito handler in scope and no msw handler for
 * anything, and this unit may not edit that file — it is FRONTEND-001's. If a
 * cold start reached the network, that suite would go red for a reason nobody
 * would connect to this change.
 *
 * This test file lives under `src/auth/` rather than beside `App.tsx` because
 * the auth wiring is what it is about, and because `src/App.test.tsx` is not
 * this unit's to extend.
 */
import { render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../App";
import { server } from "../test/server";

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

  it("renders the guest feed on a cold start without asking anyone anything", async () => {
    // The guest feed is reachable signed out ([[0x01-users]]: viewing is a
    // public read path), so a cold start must not block on, or provoke, a call.
    render(<App />);

    expect(await screen.findByRole("heading", { name: /feed/i })).toBeInTheDocument();
    expect(requests, "a signed-out cold start makes no request").toEqual([]);
  });
});
