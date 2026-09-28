/**
 * FRONTEND-002 acceptance criteria 8 and 9 — creating a Cognito identity.
 *
 * Sign-up creates the *identity*; `POST /users` creates the application
 * profile, and that is a different page. So all this one owes is: call
 * `signUp` through the injected service, and send the user to the step Cognito
 * says comes next.
 *
 * Failures land on the field they are about. Which field is what is pinned, not
 * the prose: "that email is taken" belongs on the email input and "that
 * password is too weak" belongs on the password input, and a single banner at
 * the top of the form is the failure this criterion exists to prevent. The
 * association is asserted through the accessible description, which is what a
 * screen reader actually reads out — a `<p>` sitting next to an input is not a
 * field-level error.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { FakeAuthService, TEST_EMAIL, TEST_PASSWORD, renderWithAuth } from "../test/auth";
import { SignUpPage } from "./SignUpPage";

function ConfirmStub() {
  const { state } = useLocation();
  const email = (state as { email?: string } | null)?.email;
  return <p>confirm stub for {email ?? "nobody"}</p>;
}

function renderSignUp(authService: FakeAuthService) {
  return renderWithAuth(
    <Routes>
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/confirm" element={<ConfirmStub />} />
      <Route path="/sign-in" element={<p>sign-in stub</p>} />
    </Routes>,
    { authService, route: "/sign-up" },
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^email$/i), TEST_EMAIL);
  await user.type(screen.getByLabelText(/^password$/i), TEST_PASSWORD);
  await user.click(screen.getByRole("button", { name: /sign up/i }));
}

/** A field-level error: the control is marked invalid and says why, to a screen reader. */
function expectFieldError(field: HTMLElement): void {
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription();
}

function expectNoFieldError(field: HTMLElement): void {
  expect(field).not.toHaveAttribute("aria-invalid", "true");
}

describe("SignUpPage", () => {
  it("is the sign-up view", () => {
    renderSignUp(new FakeAuthService());

    expect(screen.getByRole("heading", { name: /sign\s*-?\s*up/i })).toBeInTheDocument();
  });

  it("labels both of its inputs", () => {
    renderSignUp(new FakeAuthService());

    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it("signs up through the injected service", async () => {
    const user = userEvent.setup();
    const service = new FakeAuthService();
    renderSignUp(service);

    await fillAndSubmit(user);

    expect(service.callsTo("signUp")).toEqual([{ email: TEST_EMAIL, password: TEST_PASSWORD }]);
  });

  it("sends an unconfirmed account on to the confirmation step, carrying the email", async () => {
    // Cognito with email verification answers `userConfirmed: false`; making the
    // user retype the address they just typed is the avoidable part.
    const user = userEvent.setup();
    renderSignUp(new FakeAuthService({ userConfirmed: false }));

    await fillAndSubmit(user);

    expect(await screen.findByText(`confirm stub for ${TEST_EMAIL}`)).toBeInTheDocument();
  });

  it("sends an already-confirmed account straight to sign-in", async () => {
    const user = userEvent.setup();
    renderSignUp(new FakeAuthService({ userConfirmed: true }));

    await fillAndSubmit(user);

    expect(await screen.findByText("sign-in stub")).toBeInTheDocument();
  });

  it("puts a taken address on the email field", async () => {
    const user = userEvent.setup();
    renderSignUp(new FakeAuthService().failWith("signUp", "UsernameExistsException"));

    await fillAndSubmit(user);

    await screen.findByRole("heading", { name: /sign\s*-?\s*up/i });
    expectFieldError(await screen.findByLabelText(/^email$/i));
    expectNoFieldError(screen.getByLabelText(/^password$/i));
  });

  it("puts a rejected password on the password field", async () => {
    const user = userEvent.setup();
    renderSignUp(new FakeAuthService().failWith("signUp", "InvalidPasswordException"));

    await fillAndSubmit(user);

    expectFieldError(await screen.findByLabelText(/^password$/i));
    expectNoFieldError(screen.getByLabelText(/^email$/i));
  });

  it("stays on the page when sign-up fails", async () => {
    const user = userEvent.setup();
    renderSignUp(new FakeAuthService().failWith("signUp", "UsernameExistsException"));

    await fillAndSubmit(user);

    expect(await screen.findByLabelText(/^email$/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/confirm stub/)).toBeNull();
    expect(screen.queryByText("sign-in stub")).toBeNull();
  });
});
