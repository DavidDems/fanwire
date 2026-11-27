/**
 * FRONTEND-002 acceptance criteria 6, 8 and 9 — signing in.
 *
 * The half of criterion 6 the guard cannot do on its own: the guard remembers
 * where the anonymous visitor was going, and this page is what takes them
 * there. Landing everyone on the feed after sign-in is the defect — the person
 * clicked "Notifications", not "Feed".
 *
 * Sign-in goes through `useAuth().signIn` rather than the service directly, so
 * the session the guards read is updated by the same call that authenticates.
 * `src/routes/auth-flow.test.tsx` pins that end to end; here it is pinned at the
 * page's own boundary.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { FakeAuthService, TEST_EMAIL, TEST_PASSWORD, renderWithAuth } from "../test/auth";
import { SignInPage } from "./SignInPage";

function ConfirmStub() {
  const { state } = useLocation();
  const email = (state as { email?: string } | null)?.email;
  return <p>confirm stub for {email ?? "nobody"}</p>;
}

/**
 * `route: "/"` bounces through a redirect that carries `state.from`, which is
 * exactly what `RequireAuth` does. `renderWithProviders` only takes a path, and
 * the state is the point of the test.
 */
function renderSignIn(authService: FakeAuthService, from?: string) {
  return renderWithAuth(
    <Routes>
      <Route
        path="/"
        element={
          from ? (
            <Navigate
              to="/sign-in"
              state={{ from: { pathname: from, search: "", hash: "" } }}
              replace
            />
          ) : (
            <p>feed stub</p>
          )
        }
      />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/confirm" element={<ConfirmStub />} />
      <Route path="/notifications" element={<p>notifications stub</p>} />
    </Routes>,
    { authService, route: from ? "/" : "/sign-in" },
  );
}

/** The fixed alert for any code the page has no field for (ForgotPasswordPage's wording). */
const GENERIC_FAILURE = "Something went wrong. Please try again.";
/** Distinctive provider text: it must never reach the page. */
const PROVIDER_TEXT = "Provider says: user does not exist";
/** Codes the page maps to no field, including one Cognito has never sent. */
const UNMAPPED_CODES = ["UserNotFoundException", "InternalErrorException", "MadeUpProviderException"];

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/^email$/i), TEST_EMAIL);
  await user.type(screen.getByLabelText(/^password$/i), TEST_PASSWORD);
  await user.click(screen.getByRole("button", { name: /sign\s*-?\s*in/i }));
}

function expectFieldError(field: HTMLElement): void {
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription();
}

function expectNoFieldError(field: HTMLElement): void {
  expect(field).not.toHaveAttribute("aria-invalid", "true");
}

describe("SignInPage", () => {
  it("is the sign-in view, with both inputs labelled", () => {
    renderSignIn(new FakeAuthService());

    expect(screen.getByRole("heading", { name: /sign\s*-?\s*in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it("keeps a forgot-password link, named with 'Forgot', below the password field (AUTH-001)", () => {
    renderSignIn(new FakeAuthService());

    const link = screen.getByRole("link", { name: /forgot/i });
    expect(link).toHaveAttribute("href", "/forgot-password");
    const password = screen.getByLabelText(/^password$/i);
    expect(
      password.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("signs in through the injected service", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderSignIn(service);

    await fillAndSubmit(user);

    expect(service.callsTo("signIn")).toEqual([{ email: TEST_EMAIL, password: TEST_PASSWORD }]);
  });

  it("lands on the feed when nothing was interrupted", async () => {
    const user = userEvent.setup();
    renderSignIn(new FakeAuthService());

    await fillAndSubmit(user);

    expect(await screen.findByText("feed stub")).toBeInTheDocument();
  });

  it("sends the user on to the route they originally asked for", async () => {
    const user = userEvent.setup();
    renderSignIn(new FakeAuthService(), "/notifications");

    await fillAndSubmit(user);

    expect(await screen.findByText("notifications stub")).toBeInTheDocument();
    expect(screen.queryByText("feed stub")).toBeNull();
  });

  it("puts a wrong password on the password field", async () => {
    const user = userEvent.setup();
    renderSignIn(new FakeAuthService().failWith("signIn", "NotAuthorizedException"));

    await fillAndSubmit(user);

    expectFieldError(await screen.findByLabelText(/^password$/i));
    expectNoFieldError(screen.getByLabelText(/^email$/i));
  });

  it.each(UNMAPPED_CODES)(
    "shows one fixed message for %s and never the provider's own text",
    async (code) => {
      // The pool sets `preventUserExistenceErrors`, so Cognito does not send
      // `UserNotFoundException` here; if it ever did, its text ("User does not
      // exist.") would name account existence, the leak the setting exists to
      // stop. Every code the page has no field for gets the same fixed alert.
      const user = userEvent.setup();
      renderSignIn(new FakeAuthService().failWith("signIn", code, PROVIDER_TEXT));

      await fillAndSubmit(user);

      expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_FAILURE);
      expect(document.body).not.toHaveTextContent(PROVIDER_TEXT);
      expectNoFieldError(screen.getByLabelText(/^email$/i));
      expectNoFieldError(screen.getByLabelText(/^password$/i));
    },
  );

  it("sends an unconfirmed account to the confirmation step instead of erroring", async () => {
    // `UserNotConfirmedException` is a routing state, the same way a 404 from
    // `GET /users/me` is: the credentials were right, the email was never
    // confirmed. A field-level error here dead-ends the only account they have.
    const user = userEvent.setup();
    renderSignIn(new FakeAuthService().failWith("signIn", "UserNotConfirmedException"));

    await fillAndSubmit(user);

    expect(await screen.findByText(`confirm stub for ${TEST_EMAIL}`)).toBeInTheDocument();
  });

  it("stays on the page when sign-in fails", async () => {
    const user = userEvent.setup();
    renderSignIn(new FakeAuthService().failWith("signIn", "NotAuthorizedException"));

    await fillAndSubmit(user);

    expect(await screen.findByLabelText(/^password$/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("feed stub")).toBeNull();
  });
});
