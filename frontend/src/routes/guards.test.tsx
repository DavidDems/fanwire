/**
 * FRONTEND-002 acceptance criteria 4, 5 and 6 — the route guards.
 *
 * Three states, and the guard has to tell them apart (brief, "Route guard"):
 *
 * | state                        | goes to                                  |
 * |------------------------------|------------------------------------------|
 * | no session                   | sign-in, remembering the requested route |
 * | session, `GET /users/me` 404 | profile creation                         |
 * | session, `GET /users/me` 200 | the route they asked for                 |
 *
 * `RequireNewProfile` is the same table read backwards, and it is what stops
 * profile creation being reachable by someone who already has a profile.
 *
 * The fourth state is "we do not know yet". Both guards render an accessible
 * loading status while the session or the profile is unresolved, because the
 * alternative — guessing — shows a signed-in user the sign-in page on every
 * reload. Both unresolved cases are held open deliberately here rather than
 * raced.
 */
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { AuthService } from "../auth/AuthService";
import {
  FakeAuthService,
  profileDeactivated,
  profileForbidden,
  profileFound,
  profileMissing,
  renderWithAuth,
  testSession,
} from "../test/auth";
import { server } from "../test/server";
import { RequireAuth, RequireNewProfile } from "./guards";

function SignInStub() {
  const { state } = useLocation();
  const from = (state as { from?: { pathname?: string } } | null)?.from;
  return <p>sign-in stub, sent from {from?.pathname ?? "nowhere"}</p>;
}

function signedIn(): FakeAuthService {
  return new FakeAuthService({ session: testSession() });
}

/** A route tree with somewhere to land for each of the three outcomes. */
function renderGuarded(guarded: ReactElement, authService: AuthService) {
  return renderWithAuth(
    <Routes>
      <Route path="/" element={<p>feed stub</p>} />
      <Route path="/sign-in" element={<SignInStub />} />
      <Route path="/create-profile" element={<p>create-profile stub</p>} />
      <Route path="/guarded" element={guarded} />
    </Routes>,
    { authService, route: "/guarded" },
  );
}

/** A `GET /users/me` that does not answer until the returned function is called. */
function heldProfileRequest(): () => void {
  let release = () => {};
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get("*/users/me", async () => {
      await answered;
      return HttpResponse.json({ detail: "Not Found" }, { status: 404 });
    }),
  );
  return release;
}

describe("RequireAuth", () => {
  it("sends an anonymous visitor to sign-in, remembering where they were going", async () => {
    renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      new FakeAuthService(),
    );

    expect(
      await screen.findByText("sign-in stub, sent from /guarded"),
    ).toBeInTheDocument();
    expect(screen.queryByText("protected content")).toBeNull();
  });

  it("does not ask the API who the anonymous visitor is", async () => {
    // A profile lookup with no token is a 401 the app would have to explain
    // away. The handler is here only to record: without it, an unexpected
    // request would fail as "unhandled" instead of naming the actual defect.
    const asked: string[] = [];
    server.use(
      http.get("*/users/me", ({ request }) => {
        asked.push(request.url);
        return HttpResponse.json({ detail: "Not Found" }, { status: 404 });
      }),
    );

    renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      new FakeAuthService(),
    );
    await screen.findByText(/sign-in stub/);

    expect(asked).toEqual([]);
  });

  it("sends a signed-in user with no profile to profile creation, not to an error", async () => {
    server.use(profileMissing());

    renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      signedIn(),
    );

    expect(await screen.findByText("create-profile stub")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("protected content")).toBeNull();
  });

  it("renders the protected route for a signed-in user who has a profile", async () => {
    server.use(profileFound());

    renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      signedIn(),
    );

    expect(await screen.findByText("protected content")).toBeInTheDocument();
    expect(screen.queryByText(/sign-in stub/)).toBeNull();
  });

  it("shows a loading status while the session is unresolved", async () => {
    server.use(profileFound());
    const service = signedIn();
    const resume = service.pause();

    renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      service,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/sign-in stub/)).toBeNull();
    expect(screen.queryByText("protected content")).toBeNull();

    resume();

    expect(await screen.findByText("protected content")).toBeInTheDocument();
  });

  it("shows a loading status while the profile lookup is in flight", async () => {
    const answer = heldProfileRequest();

    renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      signedIn(),
    );

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("create-profile stub")).toBeNull();
    expect(screen.queryByText("protected content")).toBeNull();

    answer();

    expect(await screen.findByText("create-profile stub")).toBeInTheDocument();
  });

  it("gives its loading status an accessible name", async () => {
    // `role="status"` with no text is invisible to a screen reader and useless
    // to the next person debugging a hang.
    server.use(profileFound());
    const service = signedIn();
    const resume = service.pause();

    renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      service,
    );

    expect(screen.getByRole("status").textContent?.trim()).not.toBe("");

    resume();
    await screen.findByText("protected content");
  });
});

describe("RequireNewProfile", () => {
  it("sends an anonymous visitor to sign-in", async () => {
    renderGuarded(
      <RequireNewProfile>
        <p>profile form</p>
      </RequireNewProfile>,
      new FakeAuthService(),
    );

    expect(await screen.findByText(/sign-in stub/)).toBeInTheDocument();
    expect(screen.queryByText("profile form")).toBeNull();
  });

  it("renders the form for a signed-in user who has no profile yet", async () => {
    server.use(profileMissing());

    renderGuarded(
      <RequireNewProfile>
        <p>profile form</p>
      </RequireNewProfile>,
      signedIn(),
    );

    expect(await screen.findByText("profile form")).toBeInTheDocument();
  });

  it("sends a user who already has a profile back to the feed", async () => {
    server.use(profileFound());

    renderGuarded(
      <RequireNewProfile>
        <p>profile form</p>
      </RequireNewProfile>,
      signedIn(),
    );

    expect(await screen.findByText("feed stub")).toBeInTheDocument();
    expect(screen.queryByText("profile form")).toBeNull();
  });

  it("shows a loading status rather than flashing the form", async () => {
    const answer = heldProfileRequest();

    renderGuarded(
      <RequireNewProfile>
        <p>profile form</p>
      </RequireNewProfile>,
      signedIn(),
    );

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("profile form")).toBeNull();

    answer();

    expect(await screen.findByText("profile form")).toBeInTheDocument();
  });
});

/**
 * FRONTEND-012 criterion 11 — the fourth answer `GET /users/me` can give: 403
 * `{"detail": "account_deactivated"}` (`USERS-003`).
 *
 * | state                                  | `RequireAuth`        | `RequireNewProfile`        |
 * |----------------------------------------|----------------------|----------------------------|
 * | session, `GET /users/me` 403 deactivated | the recovery screen | never the profile form     |
 * | session, any other 403                 | the "could not check" alert, as before |
 *
 * The recovery screen is not an error and not a redirect: it is where a
 * deactivated account learns what recovery does and does it, on the route it
 * asked for, so recovering lands it on that route.
 */
describe("a deactivated account (FRONTEND-012)", () => {
  it("RequireAuth shows the recovery screen instead of the route", async () => {
    server.use(profileDeactivated());

    renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      signedIn(),
    );

    expect(
      await screen.findByRole("heading", { name: /deactivated/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Recover account" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("protected content")).toBeNull();
  });

  it("RequireAuth's recovery screen is neither sign-in, profile creation nor an error", async () => {
    server.use(profileDeactivated());

    renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      signedIn(),
    );

    await screen.findByRole("heading", { name: /deactivated/i });
    expect(screen.queryByText(/sign-in stub/)).toBeNull();
    expect(screen.queryByText("create-profile stub")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("RequireAuth's recovery screen says what recovery restores, and what it does not", async () => {
    server.use(profileDeactivated());

    const { container } = renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      signedIn(),
    );

    await screen.findByRole("heading", { name: /deactivated/i });
    expect(container.textContent).toMatch(/restore/i);
    expect(container.textContent).toMatch(/deleted/i);
  });

  it("RequireNewProfile never offers profile creation to it", async () => {
    server.use(profileDeactivated());

    renderGuarded(
      <RequireNewProfile>
        <p>profile form</p>
      </RequireNewProfile>,
      signedIn(),
    );

    // Settled: neither guard's loading status (session, then profile) is left.
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByText("profile form")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("any other 403 is still the could-not-check alert", async () => {
    server.use(profileForbidden());

    renderGuarded(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      signedIn(),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Recover account" }),
    ).toBeNull();
  });
});
