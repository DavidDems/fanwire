/**
 * FRONTEND-002 — the session state every page and guard reads.
 *
 * `AuthProvider` takes the service as a prop (`<AuthProvider authService={…}>`)
 * rather than constructing one. That is the whole dependency inversion: the app
 * injects the Cognito implementation, a test injects a double, and no page ever
 * learns which it got.
 *
 * Two properties here are load-bearing elsewhere:
 *
 * - **`status` has a third value.** "Not signed in" and "we do not know yet"
 *   are different states; collapsing them is what makes a guard flash the
 *   sign-in page at a signed-in user on every reload.
 * - **A cold start makes no HTTP request.** `src/App.test.tsx` renders the real
 *   `<App />` with no handler for anything, and this unit may not edit that file.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FakeAuthService,
  TEST_EMAIL,
  TEST_PASSWORD,
  renderWithAuth,
  testSession,
} from "../test/auth";
import { server } from "../test/server";
import { AuthProvider, useAuth } from "./AuthContext";
import type { AuthService } from "./AuthService";

let observedService: AuthService | null = null;

function Probe() {
  const { session, status, signIn, signOut, authService } = useAuth();
  observedService = authService;

  return (
    <div>
      <p>status: {status}</p>
      <p>email: {session ? session.email : "nobody"}</p>
      <button
        type="button"
        onClick={() => {
          void signIn({ email: TEST_EMAIL, password: TEST_PASSWORD });
        }}
      >
        sign in
      </button>
      <button type="button" onClick={signOut}>
        sign out
      </button>
    </div>
  );
}

let requests: string[] = [];

function onRequestStart({ request }: { request: Request }): void {
  requests.push(request.url);
}

beforeEach(() => {
  observedService = null;
  requests = [];
  server.events.on("request:start", onRequestStart);
});

afterEach(() => {
  server.events.removeListener("request:start", onRequestStart);
});

describe("useAuth", () => {
  it("fails fast outside an AuthProvider", () => {
    // Validate at the boundary: a component rendered outside the provider is a
    // wiring mistake, and a silently-anonymous context would turn it into a
    // logged-out user who cannot work out why.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(/AuthProvider/i);

    consoleError.mockRestore();
  });
});

describe("AuthProvider", () => {
  it("restores the session from the service once, on mount", async () => {
    const service = new FakeAuthService({ session: testSession() });

    renderWithAuth(<Probe />, { authService: service });

    expect(await screen.findByText("status: authenticated")).toBeInTheDocument();
    expect(screen.getByText(`email: ${TEST_EMAIL}`)).toBeInTheDocument();
    expect(service.callsTo("refreshSession")).toHaveLength(1);
  });

  it("settles on anonymous when there is nothing to restore", async () => {
    renderWithAuth(<Probe />, { authService: new FakeAuthService() });

    expect(await screen.findByText("status: anonymous")).toBeInTheDocument();
    expect(screen.getByText("email: nobody")).toBeInTheDocument();
  });

  it("reports loading until the restore settles, never anonymous", async () => {
    const service = new FakeAuthService({ session: testSession() });
    const resume = service.pause();

    renderWithAuth(<Probe />, { authService: service });

    expect(screen.getByText("status: loading")).toBeInTheDocument();
    expect(screen.queryByText("status: anonymous")).toBeNull();

    resume();

    expect(await screen.findByText("status: authenticated")).toBeInTheDocument();
  });

  it("makes no HTTP request of its own on a cold start", async () => {
    renderWithAuth(<Probe />, { authService: new FakeAuthService() });

    await screen.findByText("status: anonymous");

    expect(requests, "the provider asks the service, not the API").toEqual([]);
  });

  it("stores the session a successful sign-in returns", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderWithAuth(<Probe />, { authService: service });
    await screen.findByText("status: anonymous");

    await user.click(screen.getByRole("button", { name: "sign in" }));

    expect(await screen.findByText("status: authenticated")).toBeInTheDocument();
    expect(screen.getByText(`email: ${TEST_EMAIL}`)).toBeInTheDocument();
    expect(service.callsTo("signIn")).toEqual([{ email: TEST_EMAIL, password: TEST_PASSWORD }]);
  });

  it("clears the session on sign-out, through the service", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService({ session: testSession() });
    renderWithAuth(<Probe />, { authService: service });
    await screen.findByText("status: authenticated");

    await user.click(screen.getByRole("button", { name: "sign out" }));

    expect(await screen.findByText("status: anonymous")).toBeInTheDocument();
    expect(service.callsTo("signOut")).toHaveLength(1);
  });

  it("hands pages the injected service itself, not a copy", async () => {
    // Sign-up, confirm and forgot-password call operations the context holds no
    // state for. They reach them through this, so they still depend on the
    // interface rather than importing an implementation.
    const service = new FakeAuthService();

    render(
      <AuthProvider authService={service}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("status: anonymous");

    expect(observedService).toBe(service);
  });
});
